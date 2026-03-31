import { Command } from 'commander';

import type { ScanCommandOptions } from '../config/options.js';
import { resolveAwsExecutionContext } from '../config/credentials.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_SCAN_OUTPUT,
  ensureVpcIncluded,
  parseRegionOption,
  parseServiceOption,
} from '../config/options.js';
import { ConfigurationError } from '../errors/cli-error.js';
import { ConsoleLogger } from '../output/console-logger.js';
import { writeOutput } from '../output/io.js';
import { renderScanSummary, determineSilentExitCode } from '../output/scan-summary.js';
import { formatReadOnlyMessage } from '../output/theme.js';
import { runAwsScan } from '../pipeline/aws-scan.js';
import { saveScanResults } from '../storage/file-store.js';
import { resolveStrongholdPaths } from '../storage/paths.js';

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('Scan AWS infrastructure and generate a DR posture report')
    .option('--provider <provider>', 'Cloud provider (aws)', DEFAULT_PROVIDER)
    .option('--region <regions>', 'AWS region(s), comma-separated', parseRegionOption)
    .option('--all-regions', 'Scan all enabled AWS regions', false)
    .option('--profile <profile>', 'AWS profile')
    .option('--services <services>', 'Filter services to scan', parseServiceOption)
    .option('--output <format>', 'summary|json|silent', DEFAULT_SCAN_OUTPUT)
    .option('--no-save', "Don't save scan results")
    .option('--verbose', 'Show detailed logs', false)
    .action(async (options: ScanCommandOptions) => {
      if (options.provider !== 'aws') {
        throw new ConfigurationError(`Unsupported provider: ${options.provider}. Only aws is available in v0.1.`);
      }

      const logger = new ConsoleLogger(options.verbose);
      const shouldPrint = options.output !== 'silent';
      const selectedServices = ensureVpcIncluded(options.services);
      let pendingStage: string | null = null;

      if (shouldPrint && options.output === 'summary') {
        await writeOutput(formatReadOnlyMessage());
        await writeOutput('');
        if (options.services && selectedServices && !options.services.includes('vpc')) {
          await writeOutput('Note: VPC scan included automatically (required for AZ validation).');
          await writeOutput('');
        }
      }

      const context = await resolveAwsExecutionContext({
        profile: options.profile,
        explicitRegions: options.region,
        allRegions: options.allRegions,
      });

      const execution = await runAwsScan({
        credentials: context.credentials,
        regions: context.regions,
        services: selectedServices,
        hooks: {
          onRegionStart: () => undefined,
          onRegionComplete: async (region, durationMs) => {
            if (shouldPrint && options.output === 'summary') {
              await writeOutput(`Scanning ${region}... done (${formatDuration(durationMs)})`);
            }
          },
          onProgress: (region, progress) => {
            logger.debug(`[${region}] ${progress.service} ${progress.status}`, {
              resourceCount: progress.resourceCount,
              ...(progress.error ? { error: progress.error } : {}),
            });
          },
          onStage: async (message) => {
            if (!shouldPrint || options.output !== 'summary') {
              return;
            }
            if (pendingStage) {
              await writeOutput(`${pendingStage} done`);
            }
            pendingStage = message;
          },
        },
      });

      if (pendingStage && shouldPrint && options.output === 'summary') {
        await writeOutput(`${pendingStage} done`);
        await writeOutput('');
      }

      if (options.save) {
        const paths = resolveStrongholdPaths();
        saveScanResults(execution.results, paths.latestScanPath);
      }

      if (options.verbose && execution.warnings.length > 0) {
        execution.warnings.forEach((warning) => logger.warn(`⚠️ ${warning}`));
      }

      if (options.output === 'json') {
        await writeOutput(JSON.stringify(execution.results, null, 2));
      } else if (options.output === 'summary') {
        const summary = renderScanSummary(execution.results, {
          ...(options.save ? { savedPath: '.stronghold/latest-scan.json' } : {}),
          warnings: execution.warnings,
        });
        await writeOutput(summary);
      } else {
        process.exitCode = determineSilentExitCode(execution.results.validationReport);
      }
    });
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}
