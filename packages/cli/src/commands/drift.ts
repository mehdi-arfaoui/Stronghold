import { Command } from 'commander';
import { analyzeDriftImpact, detectDrift, redact } from '@stronghold-dr/core';

import { CommandAuditSession, collectAuditFlags, resolveAuditIdentity } from '../audit/command-audit.js';
import { addGraphOverrideOptions, resolveGraphOverrides } from '../config/graph-overrides.js';
import type { DriftCheckCommandOptions } from '../config/options.js';
import { getCommandOptions } from '../config/options.js';
import { FileStoreError } from '../errors/cli-error.js';
import { writeError, writeOutput } from '../output/io.js';
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
    .option('--verbose', 'Show detailed logs', false),
  ).action(async (_: DriftCheckCommandOptions, command: Command) => {
      const options = getCommandOptions<DriftCheckCommandOptions>(command);
      const audit = new CommandAuditSession('drift_check', {
        outputFormat: 'terminal',
        ...(collectAuditFlags({
          '--save-baseline': options.saveBaseline,
          '--encrypt': options.encrypt,
          '--redact': options.redact,
          '--verbose': options.verbose,
          '--no-overrides': options.useOverrides === false,
          '--overrides': options.useOverrides !== false,
        })
          ? {
              flags: collectAuditFlags({
                '--save-baseline': options.saveBaseline,
                '--encrypt': options.encrypt,
                '--redact': options.redact,
                '--verbose': options.verbose,
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
          const rawDrift = detectDrift(baseline.nodes, current.nodes, {
            scanIdBefore: baseline.timestamp,
            scanIdAfter: current.timestamp,
            timestamp: new Date(current.timestamp),
          });
          const driftReport = analyzeDriftImpact(rawDrift, buildGraph(effectiveCurrent.nodes, effectiveCurrent.edges), {
            drpComponentIds: effectiveCurrent.drpPlan.services.flatMap((service) =>
              service.components.map((component) => component.resourceId),
            ),
          });

          const lines = [
            `Drift detected â€” ${driftReport.summary.total} change${driftReport.summary.total === 1 ? '' : 's'} since baseline (${baseline.timestamp})`,
            '',
          ];
          driftReport.changes.forEach((change) => {
            lines.push(
              `   ${severityIcon(change.severity)} ${change.severity.toUpperCase()}: ${change.id} â€” ${change.resourceId}`,
            );
            lines.push(`      ${change.description}`);
            if (change.affectedServices.length > 0) {
              lines.push(`      Impact: ${change.affectedServices.join(', ')}`);
            }
            lines.push(`      DR impact: ${change.drImpact}`);
            lines.push('');
          });
          lines.push(
            `   DRP status: ${driftReport.summary.drpStale ? 'âš ï¸ STALE' : 'âœ… CURRENT'} â€” ${driftReport.summary.drpStale ? "regenerate with 'stronghold plan generate'" : 'baseline still matches recovery assumptions'}`,
          );

          if (options.saveBaseline) {
            const savedPath = await saveScanResultsWithEncryption(current, baselinePath, options);
            lines.push(`   Baseline updated: ${savedPath}`);
          }

          await writeOutput(options.redact ? redact(lines.join('\n')) : lines.join('\n'));
          if (driftReport.changes.some((change) => change.severity === 'critical')) {
            process.exitCode = 1;
          }
          await audit.finish({
            status: 'success',
            resourceCount: effectiveCurrent.nodes.length,
          });
        } catch (error) {
          if (!isMissingBaselineError(error)) {
            throw error;
          }

          if (options.saveBaseline) {
            const savedPath = await saveScanResultsWithEncryption(current, baselinePath, options);
            await writeOutput(`No baseline found. Saved current scan as baseline to ${savedPath}.`);
            await audit.finish({
              status: 'success',
              resourceCount: effectiveCurrent.nodes.length,
            });
            return;
          }

          await writeOutput(
            "No baseline found. Run 'stronghold scan' then 'stronghold drift check --save-baseline' to establish one.",
          );
          process.exitCode = 2;
          await audit.finish({
            status: 'failure',
            resourceCount: effectiveCurrent.nodes.length,
            errorMessage: 'No baseline found.',
          });
        }
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });
}

function severityIcon(severity: string): string {
  if (severity === 'critical') {
    return 'ðŸ”´';
  }
  if (severity === 'high') {
    return 'ðŸŸ¡';
  }
  return 'ðŸŸ¢';
}

function isMissingBaselineError(error: unknown): boolean {
  return error instanceof FileStoreError && /No file found at /.test(error.message);
}
