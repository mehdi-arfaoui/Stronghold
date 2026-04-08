import fs from 'node:fs';

import { Command } from 'commander';

import { CommandAuditSession, resolveAuditIdentity } from '../audit/command-audit.js';
import { writeOutput } from '../output/io.js';
import {
  formatFindingsCount,
  hasDetectedServices,
  selectTopServiceRecommendations,
  sortServiceEntries,
} from '../output/service-helpers.js';
import { rebuildScanResults } from '../pipeline/rebuild-scan.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

const CRITICALITY_FACTORS = {
  critical: 4,
  high: 2,
  medium: 1,
  low: 0.5,
} as const;

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show the current DR posture snapshot by service')
    .option('--scan <path>', 'Path to scan results')
    .action(async (_, command: Command) => {
      const options = command.optsWithGlobals() as { readonly scan?: string; readonly passphrase?: string };
      const audit = new CommandAuditSession('status', {
        outputFormat: 'summary',
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
        const effectiveScan = await rebuildScanResults(scan);
        await writeOutput(renderStatusSnapshot(effectiveScan, paths.auditLogPath));
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

export function renderStatusSnapshot(
  scan: Awaited<ReturnType<typeof loadScanResultsWithEncryption>>,
  auditLogPath: string,
): string {
  const lines = [`DR Posture - ${scan.timestamp.slice(0, 10)}`, ''];
  if (!hasDetectedServices(scan.servicePosture)) {
    lines.push(`Global score: ${scan.validationReport.scoreBreakdown.overall}/100 (${scan.validationReport.scoreBreakdown.grade})`);
    lines.push(`Tip: Organize your resources into services with 'stronghold services detect'`);
    lines.push(`Run 'stronghold scan' to refresh.`);
    return lines.join('\n');
  }

  const ageDays = resolveDebtAgeDays(scan.timestamp, auditLogPath);
  lines.push('  Services:');

  for (const service of sortServiceEntries(scan.servicePosture.services)) {
    const icon = service.score.findingsCount.critical > 0 ? 'x' : service.score.findingsCount.high > 0 ? '!' : 'v';
    const debt = calculateDebt(service.score.criticality, ageDays, service.score.findings);
    lines.push(
      `    ${icon} ${service.service.id.padEnd(14)} ${service.score.grade}  ${String(service.score.score).padStart(3)}/100   ${formatFindingsCount(service.score.findingsCount).padEnd(22)}${debt}`,
    );
  }

  const nextAction = selectTopServiceRecommendations(scan.servicePosture.recommendations, 1)[0] ?? null;
  lines.push('');
  lines.push(
    `  Global score: ${scan.validationReport.scoreBreakdown.overall}/100 (${scan.validationReport.scoreBreakdown.grade})`,
  );
  lines.push(
    `  Next action: ${nextAction ? `${nextAction.title} [${nextAction.risk.toUpperCase()}]` : 'No safe recommendations available'}`,
  );
  lines.push('');
  lines.push(`  Run 'stronghold scan' to refresh.`);
  return lines.join('\n');
}

function calculateDebt(
  criticality: keyof typeof CRITICALITY_FACTORS,
  ageDays: number | null,
  findings: readonly unknown[],
): string {
  if (findings.length === 0) {
    return '';
  }
  if (ageDays === null) {
    return '   debt: new';
  }
  const debt = Math.round(ageDays * CRITICALITY_FACTORS[criticality]);
  return `   debt: ${debt} (${ageDays} days x ${criticality})`;
}

function resolveDebtAgeDays(scanTimestamp: string, auditLogPath: string): number | null {
  if (!fs.existsSync(auditLogPath)) {
    return null;
  }

  try {
    const entries = fs
      .readFileSync(auditLogPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as {
        readonly action?: string;
        readonly timestamp?: string;
        readonly result?: { readonly status?: string };
      })
      .filter((entry) => entry.action === 'scan' && entry.result?.status === 'success')
      .map((entry) => entry.timestamp)
      .filter((timestamp): timestamp is string => typeof timestamp === 'string')
      .sort((left, right) => left.localeCompare(right));

    if (entries.length < 2) {
      return null;
    }

    const oldest = entries[0];
    if (!oldest) {
      return null;
    }
    const current = new Date(scanTimestamp).getTime();
    const firstSeen = new Date(oldest).getTime();
    if (!Number.isFinite(current) || !Number.isFinite(firstSeen)) {
      return null;
    }

    return Math.max(0, Math.floor((current - firstSeen) / 86_400_000));
  } catch {
    return null;
  }
}
