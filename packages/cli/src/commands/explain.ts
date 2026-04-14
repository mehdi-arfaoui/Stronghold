import fs from 'node:fs';

import chalk from 'chalk';
import { Command } from 'commander';
import {
  buildReasoningChain,
  calculateRealityGap,
  redact,
  redactObject,
  type ReasoningChain,
  type ReasoningScanResult,
} from '@stronghold-dr/core';

import { CommandAuditSession, collectAuditFlags, resolveAuditIdentity } from '../audit/command-audit.js';
import type { ExplainCommandOptions } from '../config/options.js';
import { getCommandOptions } from '../config/options.js';
import { CliError } from '../errors/cli-error.js';
import { loadLocalPostureMemory } from '../history/posture-memory.js';
import { writeOutput } from '../output/io.js';
import { rebuildScanResults } from '../pipeline/rebuild-scan.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

export function registerExplainCommand(program: Command): void {
  program
    .command('explain <serviceId>')
    .description('Show the deterministic reasoning chain for a service')
    .option('--verbose', 'Show confidence levels and data sources on each step', false)
    .option('--json', 'Output the reasoning chain as JSON', false)
    .action(async (serviceId: string, _: ExplainCommandOptions, command: Command) => {
      const options = getCommandOptions<ExplainCommandOptions>(command);
      const auditFlags = collectAuditFlags({
        '--verbose': options.verbose,
        '--json': options.json,
        '--redact': options.redact,
      });
      const audit = new CommandAuditSession('explain', {
        outputFormat: options.json ? 'json' : 'summary',
        serviceId,
        ...(auditFlags ? { flags: auditFlags } : {}),
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const paths = resolveStrongholdPaths();
        const latestScan = await loadRequiredScan(paths.latestEncryptedScanPath, paths.latestScanPath, {
          passphrase: options.passphrase,
          emptyMessage: "No scan data. Run 'stronghold scan' or 'stronghold demo' first.",
        });
        const effectiveScan = await rebuildScanResults(latestScan);
        const baselineScan = await loadOptionalScan(paths.baselineEncryptedScanPath, paths.baselineScanPath, {
          passphrase: options.passphrase,
        });
        const effectivePreviousScan = baselineScan ? await rebuildScanResults(baselineScan) : null;
        const postureMemory = await loadLocalPostureMemory(effectiveScan, paths);
        const service = effectiveScan.servicePosture?.services.find(
          (candidate) =>
            candidate.service.id === serviceId ||
            candidate.service.name.toLowerCase() === serviceId.toLowerCase(),
        );
        if (!service || !effectiveScan.servicePosture) {
          throw new CliError(`Service '${serviceId}' not found. Run 'stronghold services list'.`, 1);
        }

        const realityGap =
          effectiveScan.realityGap ??
          calculateRealityGap({
            nodes: effectiveScan.nodes,
            validationReport: effectiveScan.validationReport,
            servicePosture: effectiveScan.servicePosture,
            scenarioAnalysis: effectiveScan.scenarioAnalysis,
            drpPlan: effectiveScan.drpPlan,
          });
        const chain = buildReasoningChain(
          service.service.id,
          toReasoningScanResult(effectiveScan),
          effectivePreviousScan ? toReasoningScanResult(effectivePreviousScan) : null,
          postureMemory.allLifecycles,
          realityGap,
        );

        const contents = options.json
          ? JSON.stringify(options.redact ? redactObject({ chain }) : { chain }, null, 2)
          : options.redact
            ? redact(renderReasoningChain(chain, options.verbose))
            : renderReasoningChain(chain, options.verbose);

        await writeOutput(contents);
        await audit.finish({
          status: 'success',
          resourceCount: service.service.resources.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });
}

function renderReasoningChain(chain: ReasoningChain, verbose: boolean): string {
  const lines = [`  ${chain.serviceId} - ${chain.grade} ${chain.score}/100`];
  lines.push(
    `  ${formatGapLine(chain.claimedProtection, chain.provenRecoverability, chain.realityGap)}`,
  );
  lines.push('');
  lines.push(`  ${chalk.bold('Reasoning')}`);
  lines.push('');

  chain.steps.forEach((step, index) => {
    const summary = formatStepSummary(step, index + 1);
    lines.push(summary);
    if (step.detail) {
      step.detail.split('\n').forEach((line) => {
        lines.push(`     ${line}`);
      });
    }
    if (verbose && (step.confidence !== null || step.source !== null)) {
      const parts: string[] = [];
      if (step.confidence !== null) {
        parts.push(`confidence ${step.confidence.toFixed(2)}`);
      }
      if (step.source) {
        parts.push(`source: ${step.source}`);
      }
      lines.push(`     ${chalk.dim(`[${parts.join(' | ')}]`)}`);
    }
    lines.push('');
  });

  if (chain.insights.length > 0) {
    lines.push(`  ${chalk.bold('Graph Insights')}`);
    lines.push('');
    chain.insights.forEach((insight) => {
      lines.push(`  ${formatInsightHeader(insight.type, insight.severity)} ${insight.summary}`);
      lines.push(`    ${insight.detail}`);
      insight.evidence.slice(0, 3).forEach((entry) => {
        lines.push(`    - ${entry}`);
      });
      lines.push('');
    });
  }

  lines.push(`  ${chalk.bold('Conclusion')}`);
  lines.push(`  ${chain.conclusion}`);
  lines.push('');
  lines.push(`  ${chalk.bold('Next action')}`);
  lines.push(`  ${chain.nextAction ?? 'None'}`);

  return lines.join('\n');
}

function formatGapLine(
  claimedProtection: number,
  provenRecoverability: number,
  realityGap: number,
): string {
  const label = `Reality Gap: claimed ${claimedProtection}% protected -> proven ${provenRecoverability}% recoverable -> gap ${realityGap} pts`;
  if (realityGap > 50) {
    return chalk.red(label);
  }
  if (realityGap >= 20) {
    return chalk.yellow(label);
  }
  return chalk.green(label);
}

function formatStepSummary(
  step: ReasoningChain['steps'][number],
  index: number,
): string {
  const prefix = chalk.dim(`${index}.`);
  if (step.type === 'service_composition' || step.type === 'critical_dependency') {
    return `  ${prefix} ${step.summary}`;
  }
  if (step.type === 'positive') {
    return `  ${prefix} ${chalk.green('✓')} ${chalk.green(step.summary)}`;
  }

  const color = step.severity === 'critical' || step.severity === 'high' ? chalk.red : chalk.yellow;
  return `  ${prefix} ${color('✗')} ${color(step.summary)}`;
}

function formatInsightHeader(type: string, severity: 'critical' | 'high' | 'medium'): string {
  const label = `▸ ${type.replace(/_/g, ' ').toUpperCase()} -`;
  return severity === 'critical' || severity === 'high'
    ? chalk.bold(chalk.red(label))
    : chalk.bold(chalk.yellow(label));
}

async function loadRequiredScan(
  encryptedPath: string,
  plainPath: string,
  options: {
    readonly passphrase?: string;
    readonly emptyMessage: string;
  },
) {
  if (!fs.existsSync(encryptedPath) && !fs.existsSync(plainPath)) {
    throw new CliError(options.emptyMessage, 1);
  }

  return loadScanResultsWithEncryption(resolvePreferredScanPath(encryptedPath, plainPath), {
    passphrase: options.passphrase,
  });
}

async function loadOptionalScan(
  encryptedPath: string,
  plainPath: string,
  options: {
    readonly passphrase?: string;
  },
) {
  if (!fs.existsSync(encryptedPath) && !fs.existsSync(plainPath)) {
    return null;
  }

  try {
    return await loadScanResultsWithEncryption(resolvePreferredScanPath(encryptedPath, plainPath), {
      passphrase: options.passphrase,
    });
  } catch {
    return null;
  }
}

function toReasoningScanResult(
  scan: Awaited<ReturnType<typeof rebuildScanResults>>,
): ReasoningScanResult {
  if (!scan.servicePosture) {
    throw new Error('Service posture is unavailable for reasoning.');
  }

  return {
    ...scan,
    servicePosture: scan.servicePosture,
    nodes: [...scan.nodes],
    edges: [...scan.edges],
    scannedAt: new Date(scan.timestamp),
  };
}
