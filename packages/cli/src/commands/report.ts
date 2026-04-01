import { Command } from 'commander';
import { redactObject } from '@stronghold-dr/core';

import { CommandAuditSession, collectAuditFlags, resolveAuditIdentity } from '../audit/command-audit.js';
import type { ReportCommandOptions } from '../config/options.js';
import { getCommandOptions } from '../config/options.js';
import {
  filterValidationResults,
  renderMarkdownReport,
  renderTerminalReport,
} from '../output/report-renderer.js';
import { writeOutput } from '../output/io.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

export function registerReportCommand(program: Command): void {
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
    .option('--verbose', 'Show detailed logs', false)
    .action(async (_: ReportCommandOptions, command: Command) => {
      const options = getCommandOptions<ReportCommandOptions>(command);
      const audit = new CommandAuditSession('report', {
        outputFormat: options.format,
        ...(collectAuditFlags({
          '--redact': options.redact,
          '--verbose': options.verbose,
          '--output': Boolean(options.output),
          '--category': Boolean(options.category),
          '--severity': Boolean(options.severity),
        })
          ? {
              flags: collectAuditFlags({
                '--redact': options.redact,
                '--verbose': options.verbose,
                '--output': Boolean(options.output),
                '--category': Boolean(options.category),
                '--severity': Boolean(options.severity),
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
        const report = options.redact
          ? redactObject(scan.validationReport)
          : scan.validationReport;
        const filters = {
          ...(options.category ? { category: options.category } : {}),
          ...(options.severity ? { severity: options.severity } : {}),
        };

        const contents =
          options.format === 'markdown'
            ? renderMarkdownReport(report, filters)
            : options.format === 'json'
              ? JSON.stringify(
                  {
                    ...report,
                    results: filterValidationResults(report, filters),
                  },
                  null,
                  2,
                )
              : renderTerminalReport(report, filters);

        await writeOutput(contents, options.output);
        await audit.finish({
          status: 'success',
          resourceCount: scan.nodes.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });
}
