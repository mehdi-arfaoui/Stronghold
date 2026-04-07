import { Command } from 'commander';
import {
  analyzeDriftImpact,
  analyzeDrpImpact,
  detectDrift,
  redact,
  redactObject,
} from '@stronghold-dr/core';

import { CommandAuditSession, collectAuditFlags, resolveAuditIdentity } from '../audit/command-audit.js';
import { addGraphOverrideOptions, resolveGraphOverrides } from '../config/graph-overrides.js';
import type { DriftCheckCommandOptions } from '../config/options.js';
import {
  DEFAULT_DRIFT_OUTPUT,
  getCommandOptions,
  parseFailThresholdOption,
} from '../config/options.js';
import { writeError, writeOutput } from '../output/io.js';
import {
  buildDriftCheckReport,
  determineDriftExitCode,
  formatGitHubActionsAnnotations,
  isCiEnvironment,
  renderDriftCheckTerminalReport,
} from '../output/drift.js';
import { buildGraph } from '../pipeline/graph-builder.js';
import { rebuildScanResults } from '../pipeline/rebuild-scan.js';
import {
  loadScanResultsWithEncryption,
  saveScanResultsWithEncryption,
} from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

export function registerDriftCommand(program: Command): void {
  const drift = program.command('drift').description('Detect DR drift between two scans');

  addGraphOverrideOptions(
    drift
      .command('check')
      .description('Compare a baseline and current scan')
      .option('--baseline <path>', 'Path to baseline scan')
      .option('--current <path>', 'Path to current scan')
      .option('--save-baseline', 'Promote current scan as the new baseline', false)
      .option('--format <format>', 'Output: terminal|json', DEFAULT_DRIFT_OUTPUT)
      .option('--ci', 'Enable CI-friendly output', false)
      .option(
        '--fail-threshold <number>',
        'Fail when the DR score decreases by this many points or more',
        parseFailThresholdOption,
      )
      .option('--verbose', 'Show detailed logs', false),
  ).action(async (_: DriftCheckCommandOptions, command: Command) => {
    const options = getCommandOptions<DriftCheckCommandOptions>(command);
    const ciMode = options.ci || isCiEnvironment();
    if (ciMode) {
      process.env.NO_COLOR = '1';
    }

    const audit = new CommandAuditSession('drift_check', {
      outputFormat: options.format,
      ...(collectAuditFlags({
        '--save-baseline': options.saveBaseline,
        '--encrypt': options.encrypt,
        '--redact': options.redact,
        '--verbose': options.verbose,
        '--ci': ciMode,
        '--format': options.format !== DEFAULT_DRIFT_OUTPUT,
        '--fail-threshold': typeof options.failThreshold === 'number',
        '--no-overrides': options.useOverrides === false,
        '--overrides': options.useOverrides !== false,
      })
        ? {
            flags: collectAuditFlags({
              '--save-baseline': options.saveBaseline,
              '--encrypt': options.encrypt,
              '--redact': options.redact,
              '--verbose': options.verbose,
              '--ci': ciMode,
              '--format': options.format !== DEFAULT_DRIFT_OUTPUT,
              '--fail-threshold': typeof options.failThreshold === 'number',
              '--no-overrides': options.useOverrides === false,
              '--overrides': options.useOverrides !== false,
            }),
          }
        : {}),
    });
    audit.setIdentityPromise(resolveAuditIdentity());
    await audit.start();

    try {
      const paths = resolveStrongholdPaths();
      const baselinePath =
        options.baseline ??
        resolvePreferredScanPath(paths.baselineEncryptedScanPath, paths.baselineScanPath);
      const currentPath =
        options.current ??
        resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);
      const current = await loadScanResultsWithEncryption(currentPath, {
        passphrase: options.passphrase,
      });
      const resolvedOverrides = resolveGraphOverrides(options);
      resolvedOverrides.warnings.forEach((warning) => writeError(warning));
      const effectiveCurrent = await rebuildScanResults(current, resolvedOverrides.overrides);

      try {
        const baseline = await loadScanResultsWithEncryption(baselinePath, {
          passphrase: options.passphrase,
        });
        const effectiveBaseline = await rebuildScanResults(baseline, resolvedOverrides.overrides);
        const rawDrift = detectDrift(effectiveBaseline.nodes, effectiveCurrent.nodes, {
          scanIdBefore: effectiveBaseline.timestamp,
          scanIdAfter: effectiveCurrent.timestamp,
          timestamp: new Date(effectiveCurrent.timestamp),
        });
        const enrichedDrift = analyzeDriftImpact(
          rawDrift,
          buildGraph(effectiveCurrent.nodes, effectiveCurrent.edges),
          {
            drpComponentIds: effectiveBaseline.drpPlan.services.flatMap((service) =>
              service.components.map((component) => component.resourceId),
            ),
          },
        );
        const drpImpact = analyzeDrpImpact(enrichedDrift, {
          drpPlan: effectiveBaseline.drpPlan,
          baselineNodes: effectiveBaseline.nodes,
          currentNodes: effectiveCurrent.nodes,
        });
        const report = buildDriftCheckReport({
          baselineValidation: effectiveBaseline.validationReport,
          currentValidation: effectiveCurrent.validationReport,
          driftReport: enrichedDrift,
          drpImpact,
        });

        if (options.saveBaseline) {
          await saveScanResultsWithEncryption(current, baselinePath, options);
        }

        if (ciMode) {
          formatGitHubActionsAnnotations(report).forEach((annotation) =>
            writeError(options.redact ? redact(annotation) : annotation),
          );
        }

        const output =
          options.format === 'json'
            ? JSON.stringify(options.redact ? redactObject(report) : report, null, 2)
            : renderDriftCheckTerminalReport(report, enrichedDrift, effectiveBaseline.timestamp);

        await writeOutput(options.redact && options.format !== 'json' ? redact(output) : output);
        process.exitCode = determineDriftExitCode(report, options.failThreshold ?? 1);
        await audit.finish({
          status: process.exitCode === 0 ? 'success' : 'failure',
          resourceCount: effectiveCurrent.nodes.length,
          ...(process.exitCode === 0
            ? {}
            : { errorMessage: 'Drift detected with a score decrease or DRP impact.' }),
        });
      } catch (error) {
        if (!isMissingBaselineError(error)) {
          throw error;
        }

        await saveScanResultsWithEncryption(current, baselinePath, options);
        const report = buildDriftCheckReport({
          currentValidation: effectiveCurrent.validationReport,
          driftReport: {
            scanIdBefore: effectiveCurrent.timestamp,
            scanIdAfter: effectiveCurrent.timestamp,
            timestamp: new Date(effectiveCurrent.timestamp),
            changes: [],
            summary: {
              total: 0,
              bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
              byCategory: {
                backup_changed: 0,
                redundancy_changed: 0,
                network_changed: 0,
                security_changed: 0,
                resource_added: 0,
                resource_removed: 0,
                config_changed: 0,
                dependency_changed: 0,
              },
              drpStale: false,
            },
          },
          drpImpact: {
            impacts: [],
            status: 'missing_drp',
            affectedSections: [],
            message: 'DRP status: CURRENT - baseline created from the current scan.',
          },
          baselineCreated: true,
          message: 'No baseline found. Saved current scan as baseline.',
        });

        const output =
          options.format === 'json'
            ? JSON.stringify(options.redact ? redactObject(report) : report, null, 2)
            : report.message;
        await writeOutput(options.redact && options.format !== 'json' ? redact(output) : output);
        process.exitCode = 0;
        await audit.finish({
          status: 'success',
          resourceCount: effectiveCurrent.nodes.length,
        });
      }
    } catch (error) {
      await audit.fail(error);
      throw error;
    }
  });
}

function isMissingBaselineError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'message' in error &&
    typeof error.message === 'string' &&
    /No file found at /.test(error.message)
  );
}
