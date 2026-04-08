import { Command } from 'commander';
import {
  FileEvidenceStore,
  checkFreshness,
  summarizeEvidenceMaturity,
  type Evidence,
  type FindingLifecycle,
  type ServiceDebt,
  type ValidationReport,
  type ValidationReportWithEvidence,
} from '@stronghold-dr/core';

import { CommandAuditSession, resolveAuditIdentity } from '../audit/command-audit.js';
import type { LoadedPostureMemory } from '../history/posture-memory.js';
import { loadLocalPostureMemory } from '../history/posture-memory.js';
import { renderGovernanceTip } from '../output/governance-renderer.js';
import { writeOutput } from '../output/io.js';
import {
  formatServiceOwner,
  hasDetectedServices,
  selectTopServiceRecommendations,
  sortServiceEntries,
} from '../output/service-helpers.js';
import { rebuildScanResults } from '../pipeline/rebuild-scan.js';
import type { ScanResults } from '../storage/file-store.js';
import { loadScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { resolvePreferredScanPath, resolveStrongholdPaths } from '../storage/paths.js';

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
        const evidence = await new FileEvidenceStore(paths.evidencePath).getAll();
        const postureMemory = await loadLocalPostureMemory(effectiveScan, paths);
        await writeOutput(
          renderStatusSnapshot(effectiveScan, paths.auditLogPath, evidence, postureMemory),
        );
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
  scan: ScanResults,
  _auditLogPath: string,
  evidence: readonly Evidence[] = [],
  postureMemory?: LoadedPostureMemory,
): string {
  const scanCount = postureMemory?.snapshots.length ?? 0;
  const heading =
    scanCount > 0
      ? `DR Posture - ${scan.timestamp.slice(0, 10)} (scan #${scanCount})`
      : `DR Posture - ${scan.timestamp.slice(0, 10)}`;
  const lines = [heading, ''];
  const displayedScore = scan.governance?.score.withAcceptances ?? {
    score: scan.validationReport.scoreBreakdown.overall,
    grade: scan.validationReport.scoreBreakdown.grade,
  };

  if (!hasDetectedServices(scan.servicePosture)) {
    const summary = summarizeReportEvidence(scan.validationReport);
    lines.push(
      `Global score: ${displayedScore.score}/100 (${displayedScore.grade})`,
    );
    if (scan.governance?.score) {
      lines.push(
        `Score without acceptances: ${scan.governance.score.withoutAcceptances.score}/100 (${scan.governance.score.withoutAcceptances.grade})`,
      );
    }
    if (scan.scenarioAnalysis) {
      lines.push(
        `Scenarios: ${scan.scenarioAnalysis.summary.covered}/${scan.scenarioAnalysis.summary.total} covered | ${scan.scenarioAnalysis.summary.partiallyCovered} partial | ${scan.scenarioAnalysis.summary.uncovered} uncovered`,
      );
    }
    if (summary.total > 0) {
      lines.push(
        `Evidence: ${summary.counts.observed} observed, ${summary.counts.tested} tested, ${summary.counts.expired} expired`,
      );
    }
    lines.push(
      `Trend: ${formatTrendHeadline(postureMemory)}${describeTrendDelta(postureMemory)}`,
    );
    lines.push(scan.governance ? renderGovernanceHeadline(scan) : renderGovernanceTip());
    lines.push(`Tip: Organize your resources into services with 'stronghold services detect'`);
    lines.push(`Run 'stronghold scan' to refresh. Run 'stronghold history' for the full timeline.`);
    return lines.join('\n');
  }

  const debtByService = new Map(
    (postureMemory?.currentDebt ?? []).map((service) => [service.serviceId, service] as const),
  );
  const oldestByService = buildOldestFindingByService(postureMemory?.activeLifecycles ?? []);
  const summary = summarizeReportEvidence(scan.validationReport);

  lines.push('  Services:');
  for (const service of sortServiceEntries(scan.servicePosture.services)) {
    const totalFindings = countFindings(service.score.findingsCount);
    const debt = debtByService.get(service.service.id);
    const oldest = oldestByService.get(service.service.id);
    lines.push(
      `    ${serviceIcon(service.score.findingsCount)} ${service.service.id.padEnd(14)} ${service.score.grade}  ${String(service.score.score).padStart(3)}/100   ${formatServiceFindingTotal(totalFindings).padEnd(12)} debt: ${String(Math.round(debt?.totalDebt ?? 0)).padEnd(4)} ${formatDebtTrend(debt?.trend ?? 'stable')}   owner: ${formatServiceOwner(service.service)}${oldest ? `   oldest: ${oldest.ageInDays} days` : ''}`,
    );
  }

  const ownershipWarnings = renderOwnershipWarnings(scan.servicePosture.services, scan.timestamp);
  if (ownershipWarnings.length > 0) {
    lines.push('');
    lines.push('  Ownership:');
    ownershipWarnings.forEach((warning) => {
      lines.push(`    ${warning}`);
    });
  }

  lines.push('');
  if (scan.governance) {
    lines.push('  Governance:');
    renderGovernanceSummaryLines(scan).forEach((line) => {
      lines.push(`    ${line}`);
    });
  } else {
    lines.push(`  ${renderGovernanceTip()}`);
  }

  lines.push('');
  lines.push(
    scan.governance?.score
      ? `  Score: ${displayedScore.score}/100 (${displayedScore.grade}) - without acceptances: ${scan.governance.score.withoutAcceptances.score}/100 (${scan.governance.score.withoutAcceptances.grade})`
      : `  Score: ${displayedScore.score}/100 (${displayedScore.grade})`,
  );

  if (scan.scenarioAnalysis) {
    lines.push(
      `  Scenarios: ${scan.scenarioAnalysis.summary.covered}/${scan.scenarioAnalysis.summary.total} covered | ${scan.scenarioAnalysis.summary.partiallyCovered} partial | ${scan.scenarioAnalysis.summary.uncovered} uncovered`,
    );
    const scenarioAlert = renderScenarioAlert(scan);
    if (scenarioAlert) {
      lines.push(`  ${scenarioAlert}`);
    }
  }
  if (summary.total > 0) {
    lines.push(
      `  Evidence: ${summary.counts.observed} observed, ${summary.counts.tested} tested, ${summary.counts.expired} expired`,
    );
  }
  const evidenceAlerts = renderEvidenceAlerts(evidence);
  if (evidenceAlerts.length > 0) {
    lines.push('');
    lines.push('  Evidence alerts:');
    evidenceAlerts.forEach((alert) => {
      lines.push(`    ${alert}`);
    });
  }

  lines.push('');
  lines.push(`  Trend: ${formatTrendHeadline(postureMemory)}${describeTrendDelta(postureMemory)}`);

  const highlights = buildStatusHighlights(postureMemory, evidence);
  if (highlights.length > 0) {
    lines.push('');
    lines.push('  Highlights:');
    highlights.forEach((highlight) => {
      lines.push(`    ${highlight}`);
    });
  }

  const nextAction = selectTopServiceRecommendations(scan.servicePosture.recommendations, 1)[0] ?? null;
  lines.push('');
  lines.push(
    `  Next action: ${nextAction ? `${nextAction.title} [${nextAction.risk.toUpperCase()}]` : 'No safe recommendations available'}`,
  );
  lines.push('');
  lines.push(`  Run 'stronghold scan' to refresh. Run 'stronghold history' for the full timeline.`);

  return lines.join('\n');
}

function summarizeReportEvidence(report: ValidationReport): ReturnType<typeof summarizeEvidenceMaturity> {
  if (!('results' in report) || !Array.isArray(report.results)) {
    return {
      total: 0,
      counts: {
        observed: 0,
        tested: 0,
        inferred: 0,
        declared: 0,
        expired: 0,
      },
      potentialScore: report.scoreBreakdown.overall,
    };
  }
  return hasEvidenceSummary(report)
    ? report.evidenceSummary
    : summarizeEvidenceMaturity(report.results);
}

function hasEvidenceSummary(
  report: ValidationReport,
): report is ValidationReportWithEvidence {
  return 'evidenceSummary' in report;
}

function buildOldestFindingByService(
  lifecycles: readonly FindingLifecycle[],
): ReadonlyMap<string, FindingLifecycle> {
  const oldestByService = new Map<string, FindingLifecycle>();
  lifecycles.forEach((lifecycle) => {
    if (!lifecycle.serviceId) {
      return;
    }
    const existing = oldestByService.get(lifecycle.serviceId);
    if (!existing || lifecycle.ageInDays > existing.ageInDays) {
      oldestByService.set(lifecycle.serviceId, lifecycle);
    }
  });
  return oldestByService;
}

function buildStatusHighlights(
  postureMemory: LoadedPostureMemory | undefined,
  evidence: readonly Evidence[],
): readonly string[] {
  if (!postureMemory) {
    return [];
  }

  const highlights: string[] = [];
  const topDebtFinding = postureMemory.currentDebt
    .flatMap((service) =>
      service.findingDebts.map((finding) => ({
        serviceName: service.serviceName,
        finding,
      })),
    )
    .sort(
      (left, right) =>
        right.finding.debt - left.finding.debt ||
        left.finding.findingKey.localeCompare(right.finding.findingKey),
    )[0];
  if (topDebtFinding) {
    highlights.push(
      `x ${topDebtFinding.finding.ruleId} on ${shortResourceLabel(topDebtFinding.finding.nodeId)} - ${topDebtFinding.finding.ageInDays} days unresolved (${topDebtFinding.finding.severity})`,
    );
  }

  const recurrent = postureMemory.activeLifecycles.find((lifecycle) => lifecycle.isRecurrent);
  if (recurrent) {
    highlights.push(
      `! ${recurrent.ruleId} on ${shortResourceLabel(recurrent.nodeId)} - recurrent (fixed then regressed)`,
    );
  }

  const expired = evidence
    .filter((entry) => checkFreshness(entry, new Date()).status === 'expired')
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))[0];
  if (expired) {
    highlights.push(
      `! ${evidenceLabel(expired)} evidence expired on ${shortResourceLabel(expired.subject.nodeId)}`,
    );
  }

  postureMemory.trend.highlights.forEach((highlight) => {
    const prefix = highlight.severity === 'critical' ? 'x' : highlight.severity === 'warning' ? '!' : 'i';
    const message = `${prefix} ${highlight.message}`;
    if (!highlights.includes(message)) {
      highlights.push(message);
    }
  });

  return highlights.slice(0, 3);
}

function renderScenarioAlert(scan: ScanResults): string | null {
  const summary = scan.scenarioAnalysis?.summary;
  if (!summary || summary.total === 0) {
    return null;
  }
  if (summary.uncovered > 0) {
    return `${summary.uncovered} uncovered scenario${summary.uncovered === 1 ? '' : 's'} require attention`;
  }
  if (summary.degraded > 0) {
    return `${summary.degraded} degraded scenario${summary.degraded === 1 ? '' : 's'} require attention`;
  }
  return null;
}

function renderEvidenceAlerts(evidence: readonly Evidence[]): readonly string[] {
  const asOf = new Date();
  return evidence
    .map((entry) => ({ entry, freshness: checkFreshness(entry, asOf) }))
    .filter(({ freshness }) => freshness.status === 'expiring_soon' || freshness.status === 'expired')
    .sort((left, right) => left.entry.timestamp.localeCompare(right.entry.timestamp))
    .map(({ entry, freshness }) =>
      freshness.status === 'expired'
        ? `x ${shortResourceLabel(entry.subject.nodeId)} ${evidenceLabel(entry)} evidence expired - last test: ${entry.timestamp.slice(0, 10)}`
        : `! ${shortResourceLabel(entry.subject.nodeId)} ${evidenceLabel(entry)} expires in ${freshness.daysUntilExpiry} days - re-test recommended`,
    );
}

function formatTrendHeadline(postureMemory: LoadedPostureMemory | undefined): string {
  if (!postureMemory || postureMemory.snapshots.length < 2) {
    return '- first scan';
  }

  const direction = postureMemory.trend.global.direction;
  if (direction === 'improving') {
    return '^ improving';
  }
  if (direction === 'degrading') {
    return 'v degrading';
  }
  return '- stable';
}

function describeTrendDelta(postureMemory: LoadedPostureMemory | undefined): string {
  if (!postureMemory || postureMemory.snapshots.length < 2) {
    return '';
  }

  const currentSnapshot = postureMemory.currentSnapshot;
  if (!currentSnapshot) {
    return '';
  }
  const referenceIndex = Math.max(0, postureMemory.snapshots.length - 5);
  const referenceSnapshot = postureMemory.snapshots[referenceIndex] ?? postureMemory.previousSnapshot;
  if (!referenceSnapshot) {
    return '';
  }

  const scoreDelta = currentSnapshot.globalScore - referenceSnapshot.globalScore;
  const days = diffDays(referenceSnapshot.timestamp, currentSnapshot.timestamp);
  if (scoreDelta > 0) {
    return ` (score improved ${scoreDelta} points in ${formatAgeWindow(days)})`;
  }
  if (scoreDelta < 0) {
    return ` (score dropped ${Math.abs(scoreDelta)} points in ${formatAgeWindow(days)})`;
  }
  return ` (score unchanged in ${formatAgeWindow(days)})`;
}

function formatDebtTrend(trend: ServiceDebt['trend']): string {
  if (trend === 'increasing') {
    return 'v';
  }
  if (trend === 'decreasing') {
    return '^';
  }
  return '-';
}

function serviceIcon(findingsCount: {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}): string {
  if (findingsCount.critical > 0) {
    return 'x';
  }
  if (countFindings(findingsCount) > 0) {
    return '!';
  }
  return 'v';
}

function countFindings(findingsCount: {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
}): number {
  return findingsCount.critical + findingsCount.high + findingsCount.medium + findingsCount.low;
}

function formatServiceFindingTotal(totalFindings: number): string {
  return `${totalFindings} finding${totalFindings === 1 ? '' : 's'}`;
}

function evidenceLabel(evidence: Evidence): string {
  return evidence.source.origin === 'test' ? evidence.source.testType : evidence.observation.key;
}

function shortResourceLabel(nodeId: string): string {
  return nodeId.split('/').at(-1) ?? nodeId.split(':').at(-1) ?? nodeId;
}

function formatAgeWindow(days: number): string {
  if (days < 14) {
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  const weeks = Math.max(1, Math.round(days / 7));
  return `${weeks} week${weeks === 1 ? '' : 's'}`;
}

function diffDays(startAt: string, endAt: string): number {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function renderOwnershipWarnings(
  services: NonNullable<ScanResults['servicePosture']>['services'],
  asOfTimestamp: string,
): readonly string[] {
  const asOf = new Date(asOfTimestamp).toISOString();

  return services.flatMap((service) => {
    const governance = service.service.governance;
    const owner = governance?.owner ?? service.service.owner;
    if (!governance) {
      return [];
    }

    if (governance.ownerStatus === 'unconfirmed' && owner) {
      return [`⚠ ${service.service.id} - owner unconfirmed (${owner})`];
    }
    if (governance.ownerStatus === 'review_due' && owner && governance.confirmedAt) {
      return [
        `⚠ ${service.service.id} - ownership review due (last confirmed: ${governance.confirmedAt.slice(0, 10)}, ${diffDays(governance.confirmedAt, asOf)} days ago)`,
      ];
    }
    if (governance.ownerStatus === 'none') {
      return [`⚠ ${service.service.id} - owner not assigned`];
    }
    return [];
  });
}

function renderGovernanceHeadline(scan: ScanResults): string {
  const activeAcceptances =
    scan.governance?.riskAcceptances.filter((acceptance) => acceptance.status === 'active').length ?? 0;
  const policyViolations = scan.governance?.policyViolations?.length ?? 0;
  return `${activeAcceptances} active risk acceptance${activeAcceptances === 1 ? '' : 's'}, ${policyViolations} policy violation${policyViolations === 1 ? '' : 's'}`;
}

function renderGovernanceSummaryLines(scan: ScanResults): readonly string[] {
  const activeAcceptances = scan.governance?.riskAcceptances.filter(
    (acceptance) => acceptance.status === 'active',
  ) ?? [];
  const expiredAcceptances = scan.governance?.riskAcceptances.filter(
    (acceptance) => acceptance.status === 'expired',
  ) ?? [];
  const reviewDueCount =
    scan.servicePosture?.services.filter(
      (service) => service.service.governance?.ownerStatus === 'review_due',
    ).length ?? 0;
  const policyViolationCount = scan.governance?.policyViolations?.length ?? 0;
  const nextAcceptanceExpiry = activeAcceptances
    .map((acceptance) => diffDays(scan.timestamp, acceptance.expiresAt))
    .sort((left, right) => left - right)[0];

  return [
    `${activeAcceptances.length} risk acceptance${activeAcceptances.length === 1 ? '' : 's'} active${nextAcceptanceExpiry !== undefined ? ` (earliest expires in ${nextAcceptanceExpiry} days)` : ''}`,
    `${expiredAcceptances.length} risk acceptance${expiredAcceptances.length === 1 ? '' : 's'} expired${expiredAcceptances.length > 0 ? ' - finding re-activated' : ''}`,
    `${reviewDueCount} ownership review${reviewDueCount === 1 ? '' : 's'} due`,
    `${policyViolationCount} policy violation${policyViolationCount === 1 ? '' : 's'}`,
  ];
}
