import { Command } from 'commander';
import {
  redactObject,
} from '@stronghold-dr/core';

import { CommandAuditSession, collectAuditFlags, resolveAuditIdentity } from '../audit/command-audit.js';
import { addGraphOverrideOptions, resolveGraphOverrides } from '../config/graph-overrides.js';
import type { ReportCommandOptions } from '../config/options.js';
import { getCommandOptions } from '../config/options.js';
import {
  buildServiceReportJson,
  filterValidationResults,
  renderMarkdownServiceReport,
  renderMarkdownReport,
  renderTerminalServiceReport,
  renderTerminalReport,
} from '../output/report-renderer.js';
import { writeError, writeOutput } from '../output/io.js';
import { renderRecommendationSection } from '../output/recommendations.js';
import { rebuildScanResults } from '../pipeline/rebuild-scan.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

export function registerReportCommand(program: Command): void {
  addGraphOverrideOptions(
    program
    .command('report')
    .description('Display the full DR posture report from a saved scan')
    .option('--format <format>', 'Output: terminal|markdown|json', 'terminal')
    .option('--output <file>', 'Write to file instead of stdout')
    .option('--scan <path>', 'Path to scan results')
    .option(
      '--category <cat>',
      'Filter by DR category: backup|redundancy|failover|detection|recovery|replication',
    )
    .option(
      '--severity <sev>',
      'Minimum severity to display: critical|high|medium|low',
      'low',
    )
    .option('--show-passed', 'Include passing controls with their evidence', false)
    .option('--explain-score', 'Show score decomposition and evidence maturity', false)
    .option('--verbose', 'Show detailed logs', false),
  ).action(async (_: ReportCommandOptions, command: Command) => {
      const options = getCommandOptions<ReportCommandOptions>(command);
      const auditFlags = collectAuditFlags({
        '--redact': options.redact,
        '--verbose': options.verbose,
        '--output': Boolean(options.output),
        '--category': Boolean(options.category),
        '--severity': Boolean(options.severity),
        '--show-passed': options.showPassed,
        '--explain-score': options.explainScore,
        '--no-overrides': options.useOverrides === false,
        '--overrides': options.useOverrides !== false,
      });
      const audit = new CommandAuditSession('report', {
        outputFormat: options.format,
        ...(auditFlags
          ? {
              flags: auditFlags,
            }
          : {}),
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const paths = resolveStrongholdPaths();
        const scanPath =
          options.scan ??
          resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);
        const scan = await loadScanResultsWithEncryption(scanPath, {
          passphrase: options.passphrase,
        });
        const resolvedOverrides = resolveGraphOverrides(options);
        resolvedOverrides.warnings.forEach((warning) => writeError(warning));
        const effectiveScan = await rebuildScanResults(scan, resolvedOverrides.overrides);
        const outputScan = options.redact
          ? (redactObject(effectiveScan) as typeof effectiveScan)
          : effectiveScan;
        const report = outputScan.validationReport;
        const recommendations =
          outputScan.servicePosture?.recommendations ?? [];
        const filters = {
          ...(options.category ? { category: options.category } : {}),
          ...(options.severity ? { severity: options.severity } : {}),
          ...(options.showPassed ? { showPassed: true } : {}),
          ...(options.explainScore ? { explainScore: true } : {}),
        };
        const hasServices =
          outputScan.servicePosture !== undefined &&
          outputScan.servicePosture.services.length > 0;

        const contents =
          options.format === 'markdown'
            ? `${hasServices ? renderMarkdownServiceReport(outputScan, filters) : renderMarkdownReport(report, filters)}\n\n${renderRecommendationSection(
                recommendations,
                effectiveScan.validationReport.score,
                'markdown',
              )}`
            : options.format === 'json'
              ? JSON.stringify(
                  hasServices
                    ? buildServiceReportJson(outputScan, filters)
                    : {
                        ...report,
                        results: filterValidationResults(report, filters),
                        services: [],
                        recommendations,
                      },
                  null,
                  2,
                )
              : `${hasServices ? renderTerminalServiceReport(outputScan, filters) : renderTerminalReport(report, filters)}\n\n${renderRecommendationSection(
                  recommendations,
                  effectiveScan.validationReport.score,
                  'terminal',
                )}`;

        await writeOutput(contents, options.output);
        await audit.finish({
          status: 'success',
          resourceCount: effectiveScan.nodes.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });
}
