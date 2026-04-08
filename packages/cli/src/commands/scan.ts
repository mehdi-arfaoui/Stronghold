import fs from 'node:fs';

import { Command } from 'commander';
import {
  collectGovernanceAuditEvents,
  FileEvidenceStore,
  FileAuditLogger,
  generateRecommendations,
  logGovernanceAuditEvents,
  selectTopRecommendations,
} from '@stronghold-dr/core';

import {
  CommandAuditSession,
  collectAuditFlags,
  resolveAuditIdentity,
} from '../audit/command-audit.js';
import { updateLocalPostureMemory } from '../history/posture-memory.js';
import { resolveAwsScanSettings } from '../config/aws-scan-settings.js';
import { addGraphOverrideOptions, resolveGraphOverrides } from '../config/graph-overrides.js';
import { resolveAwsExecutionContext } from '../config/credentials.js';
import type { ScanCommandOptions } from '../config/options.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_SCAN_OUTPUT,
  ensureVpcIncluded,
  getCommandOptions,
  parseConcurrencyOption,
  parseRegionOption,
  parseScannerTimeoutOption,
  parseServiceOption,
} from '../config/options.js';
import { ConfigurationError } from '../errors/cli-error.js';
import { ConsoleLogger } from '../output/console-logger.js';
import { writeError, writeOutput } from '../output/io.js';
import { renderRecommendationHighlights } from '../output/recommendations.js';
import { determineScanExitCode, renderScanSummary } from '../output/scan-summary.js';
import { formatReadOnlyMessage } from '../output/theme.js';
import { runAwsScan } from '../pipeline/aws-scan.js';
import { loadScanResultsWithEncryption, saveScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

export function registerScanCommand(program: Command): void {
  addGraphOverrideOptions(
    program
    .command('scan')
    .description('Scan AWS infrastructure and generate a DR posture report')
    .option('--provider <provider>', 'Cloud provider (aws)', DEFAULT_PROVIDER)
    .option('--region <regions>', 'AWS region(s), comma-separated', parseRegionOption)
    .option('--all-regions', 'Scan all enabled AWS regions', false)
    .option('--account <name>', 'Named account from .stronghold/config.yml')
    .option('--profile <profile>', 'AWS profile')
    .option('--role-arn <arn>', 'Assume role ARN for the scan')
    .option('--external-id <id>', 'External ID for assume-role flows')
    .option('--services <services>', 'Filter services to scan', parseServiceOption)
    .option(
      '--concurrency <number>',
      'Concurrent AWS service scanners per region (1-16)',
      parseConcurrencyOption,
    )
    .option(
      '--scanner-timeout <seconds>',
      'Per-scanner timeout in seconds (10-300)',
      parseScannerTimeoutOption,
    )
    .option('--output <format>', 'summary|json|silent', DEFAULT_SCAN_OUTPUT)
    .option('--no-save', "Don't save scan results")
    .option('--verbose', 'Show detailed logs', false),
  ).action(async (_: ScanCommandOptions, command: Command) => {
      const options = getCommandOptions<ScanCommandOptions>(command);
      let audit: CommandAuditSession | null = null;

      try {
        if (options.provider !== 'aws') {
          throw new ConfigurationError(
            `Unsupported provider: ${options.provider}. Only aws is available in v0.1.`,
          );
        }

        const logger = new ConsoleLogger(options.verbose);
        const shouldPrint = options.output !== 'silent';
        const resolvedOverrides = resolveGraphOverrides(options);
        resolvedOverrides.warnings.forEach((warning) => writeError(warning));
        const selectedServices = ensureVpcIncluded(options.services);
        const resolvedScanSettings = resolveAwsScanSettings(options);
        const paths = resolveStrongholdPaths();
        const previousScan = await loadPreviousScanResults(paths, options.passphrase);
        const previousAssignments = previousScan?.servicePosture?.detection.services;
        const evidence = await new FileEvidenceStore(paths.evidencePath).getAll();
        const flags = collectAuditFlags({
          '--all-regions': options.allRegions,
          '--no-save': !options.save,
          '--encrypt': options.encrypt,
          '--verbose': options.verbose,
          '--no-overrides': options.useOverrides === false,
          '--overrides': options.useOverrides !== false,
        });
        audit = new CommandAuditSession('scan', {
          ...(resolvedScanSettings.explicitRegions
            ? { regions: resolvedScanSettings.explicitRegions }
            : {}),
          ...(selectedServices ? { services: selectedServices } : {}),
          ...(resolvedScanSettings.profile ? { profile: resolvedScanSettings.profile } : {}),
          ...(resolvedScanSettings.roleArn ? { roleArn: resolvedScanSettings.roleArn } : {}),
          ...(resolvedScanSettings.accountName
            ? { accountName: resolvedScanSettings.accountName }
            : {}),
          concurrency: resolvedScanSettings.concurrency,
          scannerTimeoutSeconds: resolvedScanSettings.scannerTimeout,
          outputFormat: options.output,
          ...(flags ? { flags } : {}),
        });
        await audit.start();
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
          profile: resolvedScanSettings.profile,
          roleArn: resolvedScanSettings.roleArn,
          externalId: resolvedScanSettings.externalId,
          accountName: resolvedScanSettings.accountName,
          explicitRegions: resolvedScanSettings.explicitRegions,
          allRegions: resolvedScanSettings.allRegions,
        });
        const identityPromise = resolveAuditIdentity(context.credentials.aws);
        audit.setIdentityPromise(identityPromise);
        const callerIdentity = await identityPromise.catch(() => null);

        const execution = await runAwsScan({
          credentials: context.credentials,
          regions: context.regions,
          services: selectedServices,
          scannerConcurrency: resolvedScanSettings.concurrency,
          scannerTimeoutMs: resolvedScanSettings.scannerTimeout * 1_000,
          graphOverrides: resolvedOverrides.overrides,
          servicesFilePath: paths.servicesPath,
          previousAssignments,
          evidence,
          identityMetadata: {
            authMode: context.authMode,
            ...(context.profile ? { profile: context.profile } : {}),
            ...(context.roleArn ? { roleArn: context.roleArn } : {}),
            ...(context.accountName ? { accountName: context.accountName } : {}),
            ...(callerIdentity?.accountId
              ? { maskedAccountId: maskAccountId(callerIdentity.accountId) }
              : {}),
          },
          hooks: {
            onRegionStart: () => undefined,
            onRegionComplete: async (region, durationMs) => {
              if (shouldPrint && options.output === 'summary') {
                await writeOutput(`Scanning ${region}... done (${formatDuration(durationMs)})`);
              }
            },
            onProgress: (region, progress) => {
              if (options.verbose && progress.status === 'retrying') {
                logger.info(formatRetryLog(region, progress));
                return;
              }

              logger.debug(`[${region}] ${progress.service} ${progress.status}`, {
                resourceCount: progress.resourceCount,
                ...(progress.durationMs !== undefined ? { durationMs: progress.durationMs } : {}),
                ...(progress.retryCount !== undefined ? { retryCount: progress.retryCount } : {}),
                ...(progress.failureType ? { failureType: progress.failureType } : {}),
                ...(progress.error ? { error: progress.error } : {}),
              });
            },
            onServiceLog: (message) => {
              if (options.verbose) {
                logger.info(message);
              }
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

        const savedPath = options.encrypt
          ? '.stronghold/latest-scan.stronghold-enc'
          : '.stronghold/latest-scan.json';

        if (options.save) {
          await saveScanResultsWithEncryption(execution.results, paths.latestScanPath, options);
        }
        const postureMemory = await updateLocalPostureMemory(execution.results, paths);
        const allWarnings = postureMemory.warning
          ? [...execution.warnings, postureMemory.warning]
          : execution.warnings;

        if (options.verbose && allWarnings.length > 0) {
          allWarnings.forEach((warning) => logger.warn(`[WARN] ${warning}`));
        }

        const recommendations = generateRecommendations({
          nodes: execution.results.nodes,
          validationReport: execution.results.validationReport,
          drpPlan: execution.results.drpPlan,
          isDemo: execution.results.isDemo,
          redact: options.redact,
        });
        const topRecommendations = selectTopRecommendations(recommendations);

        if (options.output === 'json') {
          await writeOutput(
            JSON.stringify(
              {
                ...execution.results,
                recommendations,
              },
              null,
              2,
            ),
          );
        } else if (options.output === 'summary') {
          const summary = renderScanSummary(execution.results, {
            ...(options.save ? { savedPath } : {}),
            warnings: allWarnings,
            postureDelta: {
              currentSnapshot: postureMemory.currentSnapshot,
              previousSnapshot: postureMemory.previousSnapshot,
              lifecycleDelta: postureMemory.lifecycleDelta,
            },
          });
          await writeOutput(summary);
          if (topRecommendations.length > 0) {
            await writeOutput('');
            await writeOutput(
              renderRecommendationHighlights(
                topRecommendations,
                execution.results.governance?.score.withAcceptances.score ??
                  execution.results.validationReport.score,
                'stronghold report',
                recommendations.length,
              ),
            );
          }
        }

        process.exitCode = determineScanExitCode(execution.results);
        const governanceEvents =
          execution.results.governance && execution.results.servicePosture
            ? collectGovernanceAuditEvents(
                {
                  timestamp: execution.results.timestamp,
                  governance: execution.results.governance,
                  servicePosture: execution.results.servicePosture,
                },
                previousScan
                  ? {
                      timestamp: previousScan.timestamp,
                      governance: previousScan.governance ?? null,
                      servicePosture: previousScan.servicePosture ?? null,
                    }
                  : null,
              )
            : [];
        if (governanceEvents.length > 0) {
          await logGovernanceAuditEvents(
            new FileAuditLogger(paths.auditLogPath),
            governanceEvents,
            {
              timestamp: execution.results.timestamp,
              ...(callerIdentity ? { identity: callerIdentity } : {}),
            },
          );
        }
        await audit.finish({
          status: process.exitCode === 0 ? 'success' : 'failure',
          resourceCount: execution.results.nodes.length,
          ...(process.exitCode === 0 ? {} : { errorMessage: 'All AWS service scanners failed.' }),
        });
      } catch (error) {
        if (audit) {
          await audit.fail(error);
        }
        throw error;
      }
    });
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatRetryLog(
  region: string,
  progress: {
    readonly service: string;
    readonly failureType?: string;
    readonly error?: string;
    readonly attempt?: number;
    readonly maxAttempts?: number;
    readonly waitMs?: number;
  },
): string {
  return `[RETRY] scanner=${progress.service} region=${region} error=${progress.failureType ?? progress.error ?? 'UnknownError'} attempt=${progress.attempt ?? '?'}${progress.maxAttempts ? `/${progress.maxAttempts}` : ''} wait=${formatWait(progress.waitMs)}`;
}

function formatWait(waitMs: number | undefined): string {
  if (typeof waitMs !== 'number') {
    return '?';
  }
  return `${(waitMs / 1000).toFixed(1)}s`;
}

function maskAccountId(accountId: string): string {
  if (accountId.length <= 4) {
    return '*'.repeat(accountId.length);
  }
  return `${accountId.slice(0, 2)}****${accountId.slice(-4)}`;
}

async function loadPreviousScanResults(
  paths: ReturnType<typeof resolveStrongholdPaths>,
  passphrase: string | undefined,
): Promise<Awaited<ReturnType<typeof loadScanResultsWithEncryption>> | undefined> {
  const scanPath = resolvePreferredScanPath(paths.latestEncryptedScanPath, paths.latestScanPath);
  if (!fs.existsSync(scanPath)) {
    return undefined;
  }

  try {
    return await loadScanResultsWithEncryption(scanPath, { passphrase });
  } catch {
    return undefined;
  }
}
