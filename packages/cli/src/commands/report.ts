import { Command } from 'commander';

import type { ReportCommandOptions } from '../config/options.js';
import { loadScanResults } from '../storage/file-store.js';
import { resolveStrongholdPaths } from '../storage/paths.js';
import {
  filterValidationResults,
  renderMarkdownReport,
  renderTerminalReport,
} from '../output/report-renderer.js';
import { writeOutput } from '../output/io.js';

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
    .action(async (options: ReportCommandOptions) => {
      const paths = resolveStrongholdPaths();
      const scan = loadScanResults(options.scan ?? paths.latestScanPath);
      const filters = {
        ...(options.category ? { category: options.category } : {}),
        ...(options.severity ? { severity: options.severity } : {}),
      };

      const contents =
        options.format === 'markdown'
          ? renderMarkdownReport(scan.validationReport, filters)
          : options.format === 'json'
            ? JSON.stringify(
                {
                  ...scan.validationReport,
                  results: filterValidationResults(scan.validationReport, filters),
                },
                null,
                2,
              )
            : renderTerminalReport(scan.validationReport, filters);

      await writeOutput(contents, options.output);
    });
}
