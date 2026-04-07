import { Command } from 'commander';
import {
  generateRecommendations,
  redactObject,
} from '@stronghold-dr/core';

import { CommandAuditSession, collectAuditFlags, resolveAuditIdentity } from '../audit/command-audit.js';
import { addGraphOverrideOptions, resolveGraphOverrides } from '../config/graph-overrides.js';
import type { ReportCommandOptions } from '../config/options.js';
import { getCommandOptions } from '../config/options.js';
import {
  filterValidationResults,
  renderMarkdownReport,
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
    .option('--verbose', 'Show detailed logs', false),
  ).action(async (_: ReportCommandOptions, command: Command) => {
      const options = getCommandOptions<ReportCommandOptions>(command);
      const audit = new CommandAuditSession('report', {
        outputFormat: options.format,
        ...(collectAuditFlags({
          '--redact': options.redact,
          '--verbose': options.verbose,
          '--output': Boolean(options.output),
          '--category': Boolean(options.category),
          '--severity': Boolean(options.severity),
          '--no-overrides': options.useOverrides === false,
          '--overrides': options.useOverrides !== false,
        })
          ? {
              flags: collectAuditFlags({
                '--redact': options.redact,
                '--verbose': options.verbose,
                '--output': Boolean(options.output),
                '--category': Boolean(options.category),
                '--severity': Boolean(options.severity),
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
        const scanPath =
          options.scan ??
          resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);
        const scan = await loadScanResultsWithEncryption(scanPath, {
          passphrase: options.passphrase,
        });
        const resolvedOverrides = resolveGraphOverrides(options);
        resolvedOverrides.warnings.forEach((warning) => writeError(warning));
        const effectiveScan = await rebuildScanResults(scan, resolvedOverrides.overrides);
        const report = options.redact
          ? redactObject(effectiveScan.validationReport)
          : effectiveScan.validationReport;
        const recommendations = generateRecommendations({
          nodes: effectiveScan.nodes,
          validationReport: effectiveScan.validationReport,
          drpPlan: effectiveScan.drpPlan,
          isDemo: effectiveScan.isDemo,
          redact: options.redact,
        });
        const filters = {
          ...(options.category ? { category: options.category } : {}),
          ...(options.severity ? { severity: options.severity } : {}),
        };

        const contents =
          options.format === 'markdown'
            ? `${renderMarkdownReport(report, filters)}\n\n${renderRecommendationSection(
                recommendations,
                effectiveScan.validationReport.score,
                'markdown',
              )}`
            : options.format === 'json'
              ? JSON.stringify(
                  {
                    ...report,
                    results: filterValidationResults(report, filters),
                    recommendations,
                  },
                  null,
                  2,
                )
              : `${renderTerminalReport(report, filters)}\n\n${renderRecommendationSection(
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
