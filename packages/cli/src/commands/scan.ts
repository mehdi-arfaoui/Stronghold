import fs from 'node:fs';

import { Command } from 'commander';
import {
  type CrossAccountDetectionResult,
  DEFAULT_ACCOUNT_SCAN_TIMEOUT_MS,
  DEFAULT_MULTI_ACCOUNT_CONCURRENCY,
  MultiAccountOrchestrator,
  ScanErrorCollector,
  ScanExecutionError,
  StrongholdConfigValidationError,
  collectGovernanceAuditEvents,
  FileEvidenceStore,
  FileAuditLogger,
  generateRecommendations,
  getCallerIdentity,
  loadStrongholdConfig,
  logGovernanceAuditEvents,
  parseArn,
  selectTopRecommendations,
  type AccountScanTarget,
  type AuthTargetHint,
  type ScanContext,
  type ScanEngine,
  type StrongholdAwsAccountConfig,
  type StrongholdConfig,
} from '@stronghold-dr/core';

import {
  CommandAuditSession,
  collectAuditFlags,
} from '../audit/command-audit.js';
import { updateLocalPostureMemory } from '../history/posture-memory.js';
import { resolveAwsScanSettings } from '../config/aws-scan-settings.js';
import { addGraphOverrideOptions, resolveGraphOverrides } from '../config/graph-overrides.js';
import { resolveAwsExecutionContext } from '../config/credentials.js';
import type { ScanCommandOptions } from '../config/options.js';
import {
  DEFAULT_SCAN_CONCURRENCY,
  DEFAULT_SCANNER_TIMEOUT_SECONDS,
  DEFAULT_PROVIDER,
  DEFAULT_SCAN_OUTPUT,
  ensureVpcIncluded,
  getCommandOptions,
  parseConcurrencyOption,
  parseRegionOption,
  parseScannerTimeoutOption,
  parseServiceOption,
} from '../config/options.js';
import { CliError, ConfigurationError } from '../errors/cli-error.js';
import { ConsoleLogger } from '../output/console-logger.js';
import {
  calculateDebtChangePercent,
  renderExecutiveSummary,
  resolveExecutiveTrendFromSnapshots,
} from '../output/executive-summary.js';
import { writeError, writeOutput } from '../output/io.js';
import { renderRecommendationHighlights } from '../output/recommendations.js';
import { determineScanExitCode, renderScanSummary } from '../output/scan-summary.js';
import { formatReadOnlyMessage } from '../output/theme.js';
import { runAwsScan, type AwsScanExecution } from '../pipeline/aws-scan.js';
import { buildGraph, snapshotEdges, snapshotNodes } from '../pipeline/graph-builder.js';
import { runScanPipeline } from '../pipeline/scan-pipeline.js';
import type { ScanExecutionMetadata, ScanResults } from '../storage/file-store.js';
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
        const config = loadStrongholdConfig();
        const multiAccountSettings = resolveMultiAccountScanSettings(options, config);
        const resolvedScanSettings = multiAccountSettings
          ? null
          : resolveAwsScanSettings(options, { config });
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
        audit = new CommandAuditSession(
          'scan',
          multiAccountSettings
            ? {
                ...(selectedServices ? { services: selectedServices } : {}),
                concurrency:
                  options.concurrency ??
                  config?.defaults?.concurrency ??
                  DEFAULT_SCAN_CONCURRENCY,
                scannerTimeoutSeconds:
                  options.scannerTimeout ??
                  config?.defaults?.scannerTimeout ??
                  DEFAULT_SCANNER_TIMEOUT_SECONDS,
                outputFormat: options.output,
                note: `multi-account scan (${multiAccountSettings.length} accounts, accountConcurrency=${config?.defaults?.accountConcurrency ?? DEFAULT_MULTI_ACCOUNT_CONCURRENCY})`,
                ...(flags ? { flags } : {}),
              }
            : {
                ...(resolvedScanSettings?.explicitRegions
                  ? { regions: resolvedScanSettings.explicitRegions }
                  : {}),
                ...(selectedServices ? { services: selectedServices } : {}),
                ...(resolvedScanSettings?.profile ? { profile: resolvedScanSettings.profile } : {}),
                ...(resolvedScanSettings?.roleArn ? { roleArn: resolvedScanSettings.roleArn } : {}),
                ...(resolvedScanSettings?.accountName
                  ? { accountName: resolvedScanSettings.accountName }
                  : {}),
                concurrency: resolvedScanSettings?.concurrency ?? 5,
                scannerTimeoutSeconds: resolvedScanSettings?.scannerTimeout ?? 60,
                outputFormat: options.output,
                ...(flags ? { flags } : {}),
              },
        );
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

        const commandExecution = multiAccountSettings
          ? await executeMultiAccountScan({
              settings: multiAccountSettings,
              options,
              logger,
              shouldPrint,
              selectedServices,
              resolvedOverrides,
              paths,
              previousAssignments,
              evidence,
              accountConcurrency:
                config?.defaults?.accountConcurrency ?? DEFAULT_MULTI_ACCOUNT_CONCURRENCY,
            })
          : await executeSingleAccountScan({
              resolvedScanSettings: resolvedScanSettings ?? resolveAwsScanSettings(options, { config }),
              options,
              logger,
              shouldPrint,
              selectedServices,
              resolvedOverrides,
              paths,
              previousAssignments,
              evidence,
              pendingStageRef: {
                get value() {
                  return pendingStage;
                },
                set value(value: string | null) {
                  pendingStage = value;
                },
              },
              audit,
            });
        const execution = commandExecution.execution;
        const callerIdentity = commandExecution.callerIdentity;
        const exitCodeOverride = commandExecution.exitCodeOverride;
        const multiAccountOutput = commandExecution.multiAccountOutput;

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
              multiAccountOutput
                ? buildMultiAccountJsonOutput(execution.results, recommendations, multiAccountOutput)
                : {
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
          const currentDebt =
            postureMemory.currentSnapshot?.totalDebt ??
            postureMemory.currentDebt.reduce((sum, service) => sum + service.totalDebt, 0);
          await writeOutput('');
          await writeOutput(
            renderExecutiveSummary({
              score:
                execution.results.governance?.score.withAcceptances.score ??
                execution.results.validationReport.scoreBreakdown.overall,
              grade:
                execution.results.governance?.score.withAcceptances.grade ??
                execution.results.validationReport.scoreBreakdown.grade,
              proofOfRecovery: execution.results.proofOfRecovery ?? null,
              services: execution.results.servicePosture?.services ?? [],
              scenarioAnalysis: execution.results.scenarioAnalysis ?? null,
              scenariosCovered: execution.results.scenarioAnalysis?.summary.covered ?? 0,
              scenariosTotal: execution.results.scenarioAnalysis?.summary.total ?? 0,
              drDebt: currentDebt,
              drDebtChange: calculateDebtChangePercent(
                currentDebt,
                postureMemory.previousSnapshot?.totalDebt,
              ),
              trend: resolveExecutiveTrendFromSnapshots(
                postureMemory.currentSnapshot?.globalScore,
                postureMemory.previousSnapshot?.globalScore,
              ),
              nextAction: topRecommendations[0] ?? null,
            }),
          );
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

        process.exitCode = exitCodeOverride ?? determineScanExitCode(execution.results);
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
          ...(process.exitCode === 0
            ? {}
            : {
                errorMessage: resolveAuditFailureMessage(
                  process.exitCode,
                  Boolean(multiAccountOutput),
                ),
              }),
        });
      } catch (error) {
        if (audit) {
          await audit.fail(error);
        }
        throw mapScanCommandError(error);
      }
    });
}

interface PendingStageRef {
  value: string | null;
}

interface CommandExecutionResult {
  readonly execution: AwsScanExecution;
  readonly callerIdentity: Awaited<ReturnType<typeof resolveScanAuditIdentity>> | null;
  readonly exitCodeOverride?: 0 | 1;
  readonly multiAccountOutput?: MultiAccountJsonPayload;
}

interface MultiAccountJsonPayload {
  readonly accounts: readonly MultiAccountJsonAccount[];
  readonly errors: ReadonlyArray<{
    readonly accountId: string;
    readonly alias: string | null;
    readonly phase: string;
    readonly message: string;
    readonly timestamp: string;
  }>;
  readonly crossAccount: {
    readonly edges: CrossAccountDetectionResult['edges'];
    readonly summary: {
      readonly total: number;
      readonly byKind: Readonly<Record<string, number>>;
      readonly complete: number;
      readonly partial: number;
      readonly critical: number;
      readonly degraded: number;
      readonly informational: number;
    };
  };
  readonly summary: {
    readonly totalAccounts: number;
    readonly successfulAccounts: number;
    readonly failedAccounts: number;
    readonly totalResources: number;
    readonly resourcesByAccount: Readonly<Record<string, number>>;
    readonly totalFindings: number;
    readonly findingsByAccount: Readonly<Record<string, number>>;
    readonly crossAccountEdges: number;
  };
}

interface MultiAccountJsonAccount {
  readonly accountId: string;
  readonly alias: string | null;
  readonly status: 'success' | 'failed';
  readonly resourceCount?: number;
  readonly findingCount?: number;
  readonly scanDurationMs?: number;
  readonly error?: string;
}

interface ResolvedMultiAccountScanSetting {
  readonly accountName: string;
  readonly accountId: string;
  readonly partition: string;
  readonly profile?: string;
  readonly roleArn?: string;
  readonly externalId?: string;
  readonly authHint?: AuthTargetHint;
  readonly explicitRegions?: readonly string[];
  readonly allRegions: boolean;
  readonly scanTimeoutMs: number;
}

interface ResolvedMultiAccountTarget {
  readonly setting: ResolvedMultiAccountScanSetting;
  readonly target: AccountScanTarget;
  readonly scanContext: ScanContext;
  readonly authMode: string;
  readonly profile?: string;
  readonly roleArn?: string;
  readonly accountName?: string;
}

async function executeSingleAccountScan(input: {
  readonly resolvedScanSettings: ReturnType<typeof resolveAwsScanSettings>;
  readonly options: ScanCommandOptions & { readonly passphrase?: string; readonly encrypt: boolean; readonly redact?: boolean };
  readonly logger: ConsoleLogger;
  readonly shouldPrint: boolean;
  readonly selectedServices: ReturnType<typeof ensureVpcIncluded>;
  readonly resolvedOverrides: ReturnType<typeof resolveGraphOverrides>;
  readonly paths: ReturnType<typeof resolveStrongholdPaths>;
  readonly previousAssignments: Awaited<ReturnType<typeof loadPreviousScanResults>> extends infer TScan
    ? TScan extends { readonly servicePosture?: { readonly detection: { readonly services: infer TServices } } }
      ? TServices
      : readonly import('@stronghold-dr/core').Service[] | undefined
    : readonly import('@stronghold-dr/core').Service[] | undefined;
  readonly evidence: readonly import('@stronghold-dr/core').Evidence[];
  readonly pendingStageRef: PendingStageRef;
  readonly audit: CommandAuditSession;
}): Promise<CommandExecutionResult> {
  const context = await resolveAwsExecutionContext({
    profile: input.resolvedScanSettings.profile,
    roleArn: input.resolvedScanSettings.roleArn,
    externalId: input.resolvedScanSettings.externalId,
    accountName: input.resolvedScanSettings.accountName,
    accountId: input.resolvedScanSettings.accountId,
    partition: input.resolvedScanSettings.partition,
    authHint: input.resolvedScanSettings.authHint,
    explicitRegions: input.resolvedScanSettings.explicitRegions,
    allRegions: input.resolvedScanSettings.allRegions,
  });
  const identityPromise = resolveScanAuditIdentity(context.scanContext);
  input.audit.setIdentityPromise(identityPromise);
  const callerIdentity = await identityPromise.catch(() => null);

  const execution = await runAwsScan({
    scanContext: context.scanContext,
    regions: context.regions,
    services: input.selectedServices,
    scannerConcurrency: input.resolvedScanSettings.concurrency,
    scannerTimeoutMs: input.resolvedScanSettings.scannerTimeout * 1_000,
    graphOverrides: input.resolvedOverrides.overrides,
    servicesFilePath: input.paths.servicesPath,
    previousAssignments: input.previousAssignments,
    evidence: input.evidence,
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
        if (input.shouldPrint && input.options.output === 'summary') {
          await writeOutput(`Scanning ${region}... done (${formatDuration(durationMs)})`);
        }
      },
      onProgress: (region, progress) => {
        if (input.options.verbose && progress.status === 'retrying') {
          input.logger.info(formatRetryLog(region, progress));
          return;
        }

        input.logger.debug(`[${region}] ${progress.service} ${progress.status}`, {
          resourceCount: progress.resourceCount,
          ...(progress.durationMs !== undefined ? { durationMs: progress.durationMs } : {}),
          ...(progress.retryCount !== undefined ? { retryCount: progress.retryCount } : {}),
          ...(progress.failureType ? { failureType: progress.failureType } : {}),
          ...(progress.error ? { error: progress.error } : {}),
        });
      },
      onServiceLog: (message) => {
        if (input.options.verbose) {
          input.logger.info(message);
        }
      },
      onStage: async (message) => {
        if (!input.shouldPrint || input.options.output !== 'summary') {
          return;
        }
        if (input.pendingStageRef.value) {
          await writeOutput(`${input.pendingStageRef.value} done`);
        }
        input.pendingStageRef.value = message;
      },
    },
  });

  return {
    execution,
    callerIdentity,
  };
}

async function executeMultiAccountScan(input: {
  readonly settings: readonly ResolvedMultiAccountScanSetting[];
  readonly options: ScanCommandOptions & { readonly passphrase?: string; readonly encrypt: boolean; readonly redact?: boolean };
  readonly logger: ConsoleLogger;
  readonly shouldPrint: boolean;
  readonly selectedServices: ReturnType<typeof ensureVpcIncluded>;
  readonly resolvedOverrides: ReturnType<typeof resolveGraphOverrides>;
  readonly paths: ReturnType<typeof resolveStrongholdPaths>;
  readonly previousAssignments: Awaited<ReturnType<typeof loadPreviousScanResults>> extends infer TScan
    ? TScan extends { readonly servicePosture?: { readonly detection: { readonly services: infer TServices } } }
      ? TServices
      : readonly import('@stronghold-dr/core').Service[] | undefined
    : readonly import('@stronghold-dr/core').Service[] | undefined;
  readonly evidence: readonly import('@stronghold-dr/core').Evidence[];
  readonly accountConcurrency: number;
}): Promise<CommandExecutionResult> {
  const collector = new ScanErrorCollector();
  const accountOutputById = new Map<string, MultiAccountJsonAccount>();
  const resolvedTargets: ResolvedMultiAccountTarget[] = [];
  const totalAccounts = input.settings.length;
  const progress = { completed: 0 };
  const scannerConcurrency =
    input.options.concurrency ?? DEFAULT_SCAN_CONCURRENCY;
  const scannerTimeoutSeconds =
    input.options.scannerTimeout ?? DEFAULT_SCANNER_TIMEOUT_SECONDS;

  if (input.shouldPrint) {
    writeError(`Scanning ${totalAccounts} accounts...`);
  }

  for (const setting of input.settings) {
    try {
      const context = await resolveAwsExecutionContext({
        profile: setting.profile,
        roleArn: setting.roleArn,
        externalId: setting.externalId,
        accountName: setting.accountName,
        accountId: setting.accountId,
        partition: setting.partition,
        authHint: setting.authHint,
        explicitRegions: setting.explicitRegions,
        allRegions: setting.allRegions,
      });

      resolvedTargets.push({
        setting,
        target: {
          account: context.scanContext.account,
          regions: context.regions,
          authProvider: context.scanContext.authProvider,
          scanTimeoutMs: setting.scanTimeoutMs,
        },
        scanContext: context.scanContext,
        authMode: context.authMode,
        ...(context.profile ? { profile: context.profile } : {}),
        ...(context.roleArn ? { roleArn: context.roleArn } : {}),
        ...(context.accountName ? { accountName: context.accountName } : {}),
      });
    } catch (error) {
      const normalized = normalizeError(error);
      const account = {
        accountId: setting.accountId,
        accountAlias: setting.accountName,
        partition: setting.partition,
      };
      collector.add({
        account,
        phase: 'authentication',
        error: normalized,
        timestamp: new Date(),
      });
      accountOutputById.set(setting.accountId, {
        accountId: setting.accountId,
        alias: setting.accountName,
        status: 'failed',
        error: normalized.message,
      });
      progress.completed += 1;
      if (input.shouldPrint) {
        writeError(
          formatAccountFailureProgress(
            progress.completed,
            totalAccounts,
            setting.accountName,
            setting.accountId,
            'authentication',
            normalized.message,
          ),
        );
      }
    }
  }

  if (resolvedTargets.length === 0) {
    throw new CliError(collector.formatForCli(), 3);
  }

  const resolvedTargetByAccountId = new Map(
    resolvedTargets.map((resolvedTarget) => [resolvedTarget.target.account.accountId, resolvedTarget] as const),
  );
  const accountExecutionById = new Map<
    string,
    {
      readonly execution: AwsScanExecution;
      readonly resolvedTarget: ResolvedMultiAccountTarget;
    }
  >();

  const scanEngine: ScanEngine = {
    scanAccount: async (target) => {
      const resolvedTarget = resolvedTargetByAccountId.get(target.account.accountId);
      if (!resolvedTarget) {
        throw new ScanExecutionError(
          `No execution context resolved for account ${target.account.accountId}.`,
        );
      }

      const execution = await runAwsScan({
        scanContext: resolvedTarget.scanContext,
        regions: target.regions,
        services: input.selectedServices,
        scannerConcurrency,
        scannerTimeoutMs: scannerTimeoutSeconds * 1_000,
        graphOverrides: null,
        evidence: input.evidence,
        identityMetadata: {
          authMode: resolvedTarget.authMode,
          ...(resolvedTarget.profile ? { profile: resolvedTarget.profile } : {}),
          ...(resolvedTarget.roleArn ? { roleArn: resolvedTarget.roleArn } : {}),
          ...(resolvedTarget.accountName ? { accountName: resolvedTarget.accountName } : {}),
          maskedAccountId: maskAccountId(target.account.accountId),
        },
        hooks: {
          onRegionStart: () => undefined,
          onRegionComplete: () => undefined,
          onProgress: (region, progressUpdate) => {
            if (input.options.verbose && progressUpdate.status === 'retrying') {
              input.logger.info(formatRetryLog(region, progressUpdate));
              return;
            }

            input.logger.debug(`[${target.account.accountId}:${region}] ${progressUpdate.service} ${progressUpdate.status}`, {
              resourceCount: progressUpdate.resourceCount,
              ...(progressUpdate.durationMs !== undefined
                ? { durationMs: progressUpdate.durationMs }
                : {}),
              ...(progressUpdate.retryCount !== undefined
                ? { retryCount: progressUpdate.retryCount }
                : {}),
              ...(progressUpdate.failureType
                ? { failureType: progressUpdate.failureType }
                : {}),
              ...(progressUpdate.error ? { error: progressUpdate.error } : {}),
            });
          },
          onServiceLog: (message) => {
            if (input.options.verbose) {
              input.logger.info(message);
            }
          },
          onStage: () => undefined,
        },
      });

      accountExecutionById.set(target.account.accountId, { execution, resolvedTarget });

      return {
        account: target.account,
        regions: target.regions,
        resources: execution.regionResults.flatMap((regionResult) => regionResult.resources),
        findings: execution.results.validationReport.results,
        graph: buildGraph(execution.results.nodes, execution.results.edges),
        scanDurationMs: execution.scanMetadata.totalDurationMs,
        scannersExecuted: Array.from(
          new Set(execution.scanMetadata.scannerResults.map((scannerResult) => scannerResult.scannerName)),
        ),
        scannersSkipped: execution.scanMetadata.scannerResults
          .filter((scannerResult) => scannerResult.finalStatus === 'failed')
          .map((scannerResult) => ({
            scannerName: `${scannerResult.scannerName} (${scannerResult.region})`,
            reason: scannerResult.failureType ?? 'UnknownError',
          })),
      };
    },
  };

  const orchestrator = new MultiAccountOrchestrator({
    maxConcurrency: Math.min(input.accountConcurrency, resolvedTargets.length),
    scanEngine,
    onAccountComplete: (account, result) => {
      progress.completed += 1;
      accountOutputById.set(account.accountId, {
        accountId: account.accountId,
        alias: account.accountAlias,
        status: 'success',
        resourceCount: result.resources.length,
        findingCount: countFindings(result.findings),
        scanDurationMs: result.scanDurationMs,
      });
      if (input.shouldPrint) {
        writeError(
          formatAccountSuccessProgress(
            progress.completed,
            totalAccounts,
            account.accountAlias,
            account.accountId,
            result.resources.length,
            countFindings(result.findings),
            result.scanDurationMs,
          ),
        );
      }
    },
    onAccountError: (account, error) => {
      progress.completed += 1;
      accountOutputById.set(account.accountId, {
        accountId: account.accountId,
        alias: account.accountAlias,
        status: 'failed',
        error: error.message,
      });
      if (input.shouldPrint) {
        writeError(
          formatAccountFailureProgress(
            progress.completed,
            totalAccounts,
            account.accountAlias,
            account.accountId,
            resolveAccountErrorPhase(error),
            error.message,
          ),
        );
      }
    },
  });

  const orchestrationResult = await orchestrator.scan(
    resolvedTargets.map((resolvedTarget) => resolvedTarget.target),
  );

  for (const error of orchestrationResult.errors) {
    collector.add(error);
  }

  if (orchestrationResult.accounts.length === 0) {
    throw new CliError(
      collector.formatForCli(),
      collector.getErrors().every((error) => error.phase === 'authentication') ? 3 : 2,
    );
  }

  const mergedNodes = snapshotNodes(orchestrationResult.mergedGraph);
  const mergedEdges = snapshotEdges(orchestrationResult.mergedGraph);
  const mergedRegions = Array.from(
    new Set(
      orchestrationResult.accounts.flatMap((account) => account.regions),
    ),
  ).sort();
  const successfulExecutions = orchestrationResult.accounts
    .map((account) => accountExecutionById.get(account.account.accountId))
    .filter(
      (
        execution,
      ): execution is {
        readonly execution: AwsScanExecution;
        readonly resolvedTarget: ResolvedMultiAccountTarget;
      } => execution !== undefined,
    );
  const aggregatedWarnings = successfulExecutions.flatMap((execution) => execution.execution.warnings);
  const aggregatedScanMetadata = buildMultiAccountScanMetadata({
    totalDurationMs: orchestrationResult.totalDurationMs,
    scannerConcurrency,
    scannerTimeoutMs: scannerTimeoutSeconds * 1_000,
    mergedRegions,
    totalResources: orchestrationResult.summary.totalResources,
    executions: successfulExecutions.map((execution) => execution.execution),
  });
  const results = await runScanPipeline({
    provider: 'aws',
    regions: mergedRegions,
    nodes: mergedNodes,
    edges: mergedEdges,
    timestamp: new Date().toISOString(),
    graphOverrides: input.resolvedOverrides.overrides,
    scanMetadata: aggregatedScanMetadata,
    warnings: aggregatedWarnings,
    servicesFilePath: input.paths.servicesPath,
    previousAssignments: input.previousAssignments,
    evidence: input.evidence,
  });
  const totalFindingCount = countFindings(results.validationReport.results);
  const findingsByAccount = buildFindingsByAccount(accountOutputById);

  if (input.shouldPrint) {
    writeError(
      `Scan complete: ${orchestrationResult.accounts.length}/${totalAccounts} accounts scanned, ${orchestrationResult.summary.totalResources} resources, ${totalFindingCount} findings`,
    );
    if (collector.hasErrors()) {
      writeError(
        formatMultiAccountWarning(collector.getErrors().length),
      );
    }
  }

  return {
    execution: {
      results,
      warnings: results.warnings ?? aggregatedWarnings,
      scanMetadata: aggregatedScanMetadata,
      regionResults: successfulExecutions.flatMap((execution) => execution.execution.regionResults),
    },
    callerIdentity: null,
    exitCodeOverride: collector.hasErrors() ? 1 : 0,
    multiAccountOutput: {
      accounts: input.settings
        .map((setting) => accountOutputById.get(setting.accountId))
        .filter((account): account is MultiAccountJsonAccount => account !== undefined),
      errors: collector.getErrors().map((error) => ({
        accountId: error.account.accountId,
        alias: error.account.accountAlias,
        phase: error.phase,
        message: error.error.message,
        timestamp: error.timestamp.toISOString(),
      })),
      crossAccount: serializeCrossAccountDetection(orchestrationResult.crossAccount),
      summary: {
        totalAccounts,
        successfulAccounts: orchestrationResult.accounts.length,
        failedAccounts: collector.getErrors().length,
        totalResources: orchestrationResult.summary.totalResources,
        resourcesByAccount: buildResourceCountsByAccount(accountOutputById),
        totalFindings: totalFindingCount,
        findingsByAccount,
        crossAccountEdges: orchestrationResult.crossAccount.summary.total,
      },
    },
  };
}

function resolveMultiAccountScanSettings(
  options: ScanCommandOptions,
  config: StrongholdConfig | null,
): readonly ResolvedMultiAccountScanSetting[] | null {
  const awsAccounts = config?.aws?.accounts ?? [];
  if (options.account || awsAccounts.length <= 1) {
    return null;
  }

  if (options.profile || options.roleArn || options.externalId) {
    throw new CliError(
      'Global auth overrides are not supported for multi-account scans. Use per-account auth config or --account <alias|accountId>.',
      3,
    );
  }

  return awsAccounts.map((account) => {
    const accountName = account.alias ?? account.accountId;
    const authHint = resolveAwsAccountAuthHint(account, accountName, config);
    const roleArn = account.auth?.kind === 'assume-role' ? account.auth.roleArn : undefined;
    const explicitRegions = options.allRegions
      ? undefined
      : options.region ??
        account.regions ??
        (account.region ? [account.region] : undefined) ??
        config?.defaults?.regions ??
        (config?.aws?.region ? [config.aws.region] : undefined);
    const allRegions =
      options.allRegions ||
      (options.region
        ? false
        : account.allRegions === true || config?.defaults?.allRegions === true);

    return {
      accountName,
      accountId: account.accountId,
      partition: resolveAwsAccountPartition(account),
      ...(account.auth?.kind === 'profile'
        ? { profile: account.auth.profileName }
        : config?.aws?.profile
          ? { profile: config.aws.profile }
          : {}),
      ...(roleArn ? { roleArn } : {}),
      ...(account.auth?.kind === 'assume-role' && account.auth.externalId
        ? { externalId: account.auth.externalId }
        : {}),
      ...(authHint ? { authHint } : {}),
      ...(explicitRegions ? { explicitRegions } : {}),
      allRegions,
      scanTimeoutMs:
        account.scanTimeoutMs ??
        config?.defaults?.scanTimeoutMs ??
        DEFAULT_ACCOUNT_SCAN_TIMEOUT_MS,
    };
  });
}

function resolveAwsAccountPartition(account: StrongholdAwsAccountConfig): string {
  if (account.partition) {
    return account.partition;
  }

  const roleArn = account.auth?.kind === 'assume-role' ? account.auth.roleArn : undefined;
  if (!roleArn) {
    return 'aws';
  }

  try {
    return parseArn(roleArn).partition;
  } catch {
    return 'aws';
  }
}

function resolveAwsAccountAuthHint(
  account: StrongholdAwsAccountConfig,
  accountName: string,
  config: StrongholdConfig | null,
): AuthTargetHint | undefined {
  if (!account.auth) {
    return config?.aws?.profile
      ? {
          kind: 'profile',
          profileName: config.aws.profile,
        }
      : undefined;
  }

  switch (account.auth.kind) {
    case 'profile':
      return {
        kind: 'profile',
        profileName: account.auth.profileName,
      };
    case 'assume-role':
      return {
        kind: 'assume-role',
        ...(account.auth.roleArn ? { roleArn: account.auth.roleArn } : {}),
        ...(account.auth.sessionName ? { sessionName: account.auth.sessionName } : {}),
        ...(account.auth.externalId ? { externalId: account.auth.externalId } : {}),
      };
    case 'sso':
      if (account.auth.accountId && account.auth.accountId !== account.accountId) {
        throw new CliError(
          `SSO auth config for account ${accountName} must not override accountId.`,
          3,
        );
      }

      return {
        kind: 'sso',
        ssoProfileName: account.auth.ssoProfileName,
        accountId: account.accountId,
        roleName: account.auth.roleName,
      };
    default:
      return undefined;
  }
}

function buildMultiAccountScanMetadata(input: {
  readonly totalDurationMs: number;
  readonly scannerConcurrency: number;
  readonly scannerTimeoutMs: number;
  readonly mergedRegions: readonly string[];
  readonly totalResources: number;
  readonly executions: readonly AwsScanExecution[];
}): ScanExecutionMetadata {
  const scannerResults = input.executions.flatMap((execution) => execution.scanMetadata.scannerResults);

  return {
    totalDurationMs: input.totalDurationMs,
    scannerConcurrency: input.scannerConcurrency,
    scannerTimeoutMs: input.scannerTimeoutMs,
    scannedRegions: input.mergedRegions,
    discoveredResourceCount: input.totalResources,
    successfulScanners: input.executions.reduce(
      (sum, execution) => sum + execution.scanMetadata.successfulScanners,
      0,
    ),
    failedScanners: input.executions.reduce(
      (sum, execution) => sum + execution.scanMetadata.failedScanners,
      0,
    ),
    scannerResults,
    authMode: 'multi-account',
  };
}

function buildMultiAccountJsonOutput(
  results: ScanResults,
  recommendations: ReturnType<typeof generateRecommendations>,
  payload: MultiAccountJsonPayload,
): Record<string, unknown> {
  return {
    ...results,
    recommendations,
    scan: payload,
    graph: {
      nodes: results.nodes,
      edges: results.edges,
    },
    findings: selectValidationFindings(results.validationReport.results),
  };
}

function selectValidationFindings(
  results: ScanResults['validationReport']['results'],
): readonly ScanResults['validationReport']['results'][number][] {
  return results.filter((result) =>
    result.status === 'fail' || result.status === 'warn' || result.status === 'error',
  );
}

function serializeCrossAccountDetection(
  detection: CrossAccountDetectionResult,
): MultiAccountJsonPayload['crossAccount'] {
  return {
    edges: detection.edges,
    summary: {
      total: detection.summary.total,
      byKind: Object.fromEntries(
        [...detection.summary.byKind.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      complete: detection.summary.complete,
      partial: detection.summary.partial,
      critical: detection.summary.critical,
      degraded: detection.summary.degraded,
      informational: detection.summary.informational,
    },
  };
}

function countFindings(
  results: readonly { readonly status: string }[],
): number {
  return results.filter((result) =>
    result.status === 'fail' || result.status === 'warn' || result.status === 'error',
  ).length;
}

function buildResourceCountsByAccount(
  accounts: ReadonlyMap<string, MultiAccountJsonAccount>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Array.from(accounts.values())
      .filter((account) => account.status === 'success')
      .map((account) => [account.accountId, account.resourceCount ?? 0] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildFindingsByAccount(
  accounts: ReadonlyMap<string, MultiAccountJsonAccount>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Array.from(accounts.values())
      .filter((account) => account.status === 'success')
      .map((account) => [account.accountId, account.findingCount ?? 0] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function resolveAccountErrorPhase(error: Error): string {
  if (error.name === 'AuthenticationError') {
    return 'authentication';
  }
  if (error instanceof ScanExecutionError || error.name === 'TimeoutError') {
    return 'scanning';
  }
  return 'processing';
}

function formatAccountSuccessProgress(
  completed: number,
  total: number,
  alias: string | null,
  accountId: string,
  resourceCount: number,
  findingCount: number,
  durationMs: number,
): string {
  return `  [${completed}/${total}] OK ${formatAccountLabel(alias, accountId)} - ${resourceCount} resources, ${findingCount} findings - ${formatDuration(durationMs)}`;
}

function formatAccountFailureProgress(
  completed: number,
  total: number,
  alias: string | null,
  accountId: string,
  phase: string,
  message: string,
): string {
  return `  [${completed}/${total}] FAIL ${formatAccountLabel(alias, accountId)} - ${phase} failed: ${message}`;
}

function formatAccountLabel(alias: string | null, accountId: string): string {
  return alias ? `${alias} (${accountId})` : accountId;
}

function formatMultiAccountWarning(failedAccounts: number): string {
  return failedAccounts === 1
    ? 'Warning: 1 account failed. Cross-account edges involving the failed account may be incomplete.'
    : `Warning: ${failedAccounts} accounts failed. Cross-account edges involving failed accounts may be incomplete.`;
}

function resolveAuditFailureMessage(
  exitCode: number,
  isMultiAccount: boolean,
): string {
  if (!isMultiAccount) {
    return 'All AWS service scanners failed.';
  }

  return exitCode === 1
    ? 'Some accounts failed during the multi-account scan.'
    : 'The multi-account scan did not produce a usable result.';
}

function mapScanCommandError(error: unknown): unknown {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof ConfigurationError || error instanceof StrongholdConfigValidationError) {
    return new CliError(error.message, 3, error);
  }

  return error;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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

async function resolveScanAuditIdentity(scanContext: ScanContext) {
  const credentials = await scanContext.getCredentials();
  return getCallerIdentity({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
    region: scanContext.region,
  });
}
