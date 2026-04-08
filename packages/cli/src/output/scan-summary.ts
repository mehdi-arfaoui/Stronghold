import {
  summarizeEvidenceMaturity,
  type FindingLifecycleDelta,
  type ScanSnapshot,
  type ValidationReport,
  type WeightedValidationResult,
} from '@stronghold-dr/core';

import type { ScanExecutionMetadata, ScanResults } from '../storage/file-store.js';
import {
  formatFindingsCount,
  formatServiceOwner,
  formatSourceBadge,
  hasDetectedServices,
  sortServiceEntries,
} from './service-helpers.js';
import { renderScenarioCoverageLine } from './scenario-renderer.js';
import { theme } from './theme.js';

export function renderScanSummary(
  results: ScanResults,
  options: {
    readonly savedPath?: string;
    readonly warnings?: readonly string[];
    readonly postureDelta?: {
      readonly currentSnapshot: ScanSnapshot | null;
      readonly previousSnapshot: ScanSnapshot | null;
      readonly lifecycleDelta: FindingLifecycleDelta | null;
    };
  } = {},
): string {
  if (hasDetectedServices(results.servicePosture)) {
    return renderServiceCentricSummary(results, options);
  }

  return renderLegacyScanSummary(results, options);
}

function renderLegacyScanSummary(
  results: ScanResults,
  options: {
    readonly savedPath?: string;
    readonly warnings?: readonly string[];
    readonly postureDelta?: {
      readonly currentSnapshot: ScanSnapshot | null;
      readonly previousSnapshot: ScanSnapshot | null;
      readonly lifecycleDelta: FindingLifecycleDelta | null;
    };
  } = {},
): string {
  const lines: string[] = [];
  const displayedScore = resolveDisplayedScore(results);
  lines.push(
    `Scan complete - ${results.regions.length} region${results.regions.length === 1 ? '' : 's'} scanned`,
  );
  const temporalLines = renderTemporalDeltaLines(results, options.postureDelta);
  if (temporalLines.length > 0) {
    lines.push(...temporalLines);
  }
  lines.push('');
  lines.push(...renderExecutionMetadata(results.scanMetadata, results));
  lines.push(
    `   DR Posture Score:      ${displayedScore.score}/100 (${displayedScore.grade})`,
  );
  lines.push('');
  lines.push(...renderTopIssues(results.validationReport));
  lines.push('');
  lines.push(`   ${formatSeverityCounts(results.validationReport)}`);
  lines.push(...renderEvidenceSummary(results.validationReport));
  const scenarioCoverage = results.scenarioAnalysis
    ? renderScenarioCoverageLine(results.scenarioAnalysis.summary)
    : null;
  if (scenarioCoverage) {
    lines.push('');
    lines.push(`   ${scenarioCoverage}`);
  }

  if (options.savedPath) {
    lines.push('');
    lines.push(`   Results saved to ${options.savedPath}`);
    lines.push(`   Run '${theme.command('stronghold report')}' for full DR posture report`);
    if (scenarioCoverage) {
      lines.push(`   Run '${theme.command('stronghold scenarios')}' for scenario coverage details`);
    }
    lines.push(`   Run '${theme.command('stronghold plan generate')}' to export DRP as YAML`);
    lines.push(
      `   Run '${theme.command('stronghold plan runbook')}' to export an executable recovery runbook`,
    );
  }

  if (options.warnings && options.warnings.length > 0) {
    lines.push('');
    lines.push(
      `   ${theme.warn(`Warnings: ${options.warnings.length} issue(s). Results may be incomplete or adjusted.`)}`,
    );
  }

  return lines.join('\n');
}

function renderServiceCentricSummary(
  results: ScanResults,
  options: {
    readonly savedPath?: string;
    readonly warnings?: readonly string[];
    readonly postureDelta?: {
      readonly currentSnapshot: ScanSnapshot | null;
      readonly previousSnapshot: ScanSnapshot | null;
      readonly lifecycleDelta: FindingLifecycleDelta | null;
    };
  },
): string {
  const posture = results.servicePosture!;
  const lines: string[] = [];
  const displayedScore = resolveDisplayedScore(results);
  const discoveredResources = results.scanMetadata?.discoveredResourceCount ?? results.nodes.length;
  const duration =
    results.scanMetadata?.totalDurationMs !== undefined
      ? formatDuration(results.scanMetadata.totalDurationMs)
      : 'unknown time';

  lines.push(
    `Scan complete in ${duration} - ${discoveredResources} resources across ${results.regions.length} region${results.regions.length === 1 ? '' : 's'}`,
  );
  const temporalLines = renderTemporalDeltaLines(results, options.postureDelta);
  if (temporalLines.length > 0) {
    lines.push(...temporalLines);
  }
  lines.push('');
  lines.push(theme.section('Services'));
  lines.push('');

  for (const service of sortServiceEntries(posture.services)) {
    const owner = `owner: ${formatServiceOwner(service.service)}`;
    lines.push(
      `  ${service.service.id.padEnd(16)} ${service.score.grade}  ${String(service.score.score).padStart(3)}/100   ${formatFindingsCount(service.score.findingsCount).padEnd(22)} ${owner}`,
    );
    lines.push(`                     source: ${formatSourceBadge(service.score.detectionSource)}`);
  }

  if (posture.unassigned.resourceCount > 0) {
    const unassignedScore = posture.unassigned.score;
    const findingCount = unassignedScore
      ? formatFindingsCount(unassignedScore.findingsCount)
      : '0 critical findings';
    lines.push('');
    lines.push(
      `  Unassigned       ${unassignedScore?.grade ?? '-'}  ${String(unassignedScore?.score ?? 0).padStart(3)}/100   ${posture.unassigned.resourceCount} resources with ${findingCount}`,
    );
  }

  lines.push('');
  lines.push(`Global DR score: ${displayedScore.score}/100 (${displayedScore.grade})`);
  if (results.governance?.score) {
    lines.push(
      `Without acceptances: ${results.governance.score.withoutAcceptances.score}/100 (${results.governance.score.withoutAcceptances.grade})`,
    );
  }
  const scenarioCoverage = results.scenarioAnalysis
    ? renderScenarioCoverageLine(results.scenarioAnalysis.summary)
    : null;
  if (scenarioCoverage) {
    lines.push(scenarioCoverage);
  }
  lines.push(...renderEvidenceSummary(results.validationReport));

  if (options.savedPath) {
    lines.push(`Results saved to ${options.savedPath}`);
    lines.push(`Run '${theme.command('stronghold report')}' for the full DR posture report.`);
    if (scenarioCoverage) {
      lines.push(`Run '${theme.command('stronghold scenarios')}' for scenario coverage details.`);
    }
    lines.push(`Run '${theme.command('stronghold services list')}' to manage service definitions.`);
    lines.push(`Run '${theme.command('stronghold plan generate')}' to export DRP as YAML.`);
    lines.push(
      `Run '${theme.command('stronghold plan runbook')}' to export an executable recovery runbook.`,
    );
  }

  if (options.warnings && options.warnings.length > 0) {
    lines.push('');
    lines.push(
      `   ${theme.warn(`Warnings: ${options.warnings.length} issue(s). Results may be incomplete or adjusted.`)}`,
    );
  }

  return lines.join('\n');
}

export function determineScanExitCode(results: ScanResults): 0 | 1 {
  if (!results.scanMetadata) {
    return resolveDisplayedScore(results).score >= 60 ? 0 : 1;
  }
  return results.scanMetadata.successfulScanners > 0 ? 0 : 1;
}

export function determineSilentExitCode(report: ValidationReport): 0 | 1 {
  return report.score >= 60 ? 0 : 1;
}

function resolveDisplayedScore(
  results: ScanResults,
): { readonly score: number; readonly grade: string } {
  return results.governance?.score.withAcceptances ?? {
    score: results.validationReport.scoreBreakdown.overall,
    grade: results.validationReport.scoreBreakdown.grade,
  };
}

export function selectTopIssues(
  report: ValidationReport,
  limit = 3,
): readonly WeightedValidationResult[] {
  const critical = sortFailures(
    report.results.filter(
      (result) =>
        result.severity === 'critical' && (result.status === 'fail' || result.status === 'error'),
    ),
  );
  const high = sortFailures(
    report.results.filter(
      (result) =>
        result.severity === 'high' && (result.status === 'fail' || result.status === 'error'),
    ),
  );
  return [...critical, ...high].slice(0, limit);
}

function renderTopIssues(report: ValidationReport): readonly string[] {
  const issues = selectTopIssues(report);
  if (issues.length === 0) {
    return [`   ${theme.pass('No critical or high-severity DR failures detected.')}`];
  }

  const lines = ['   Top critical issues:'];
  issues.forEach((issue, index) => {
    lines.push(`      ${index + 1}. ${issue.ruleId} - ${issue.nodeName}`);
    lines.push(`         ${issue.message}`);
  });
  return lines;
}

function renderExecutionMetadata(
  metadata: ScanExecutionMetadata | undefined,
  results: ScanResults,
): readonly string[] {
  const lines: string[] = [];
  const discoveredResources = metadata?.discoveredResourceCount ?? results.nodes.length;
  lines.push(`   Resources discovered:  ${String(discoveredResources).padStart(3)}`);
  lines.push(`   Dependencies mapped:   ${String(results.edges.length).padStart(3)}`);
  lines.push(`   Services identified:   ${String(results.drpPlan.services.length).padStart(3)}`);

  if (!metadata) {
    lines.push('');
    return lines;
  }

  lines.push(`   Total duration:        ${formatDuration(metadata.totalDurationMs)}`);
  lines.push(`   Scanner concurrency:   ${String(metadata.scannerConcurrency).padStart(3)}`);
  lines.push(`   Scanner timeout:       ${formatTimeout(metadata.scannerTimeoutMs)}`);
  lines.push(`   Scanners succeeded:    ${String(metadata.successfulScanners).padStart(3)}`);
  lines.push(`   Scanners failed:       ${String(metadata.failedScanners).padStart(3)}`);
  lines.push(`   Regions scanned:       ${String(metadata.scannedRegions.length).padStart(3)}`);
  if (metadata.authMode) {
    lines.push(`   Auth mode:             ${metadata.authMode}`);
  }
  if (metadata.profile) {
    lines.push(`   AWS profile:           ${metadata.profile}`);
  }
  if (metadata.accountName) {
    lines.push(`   Account config:        ${metadata.accountName}`);
  }
  if (metadata.roleArn) {
    lines.push(`   Role ARN:              ${metadata.roleArn}`);
  }
  if (metadata.maskedAccountId) {
    lines.push(`   Account:               ${metadata.maskedAccountId}`);
  }

  const failedScanners = metadata.scannerResults.filter(
    (scanner) => scanner.finalStatus === 'failed',
  );
  if (failedScanners.length > 0) {
    lines.push('');
    lines.push('   Failed scanners:');
    failedScanners.forEach((scanner) => {
      lines.push(
        `      - ${scanner.scannerName} (${scanner.region}) - ${scanner.failureType ?? 'UnknownError'}`,
      );
    });
  }

  lines.push('');
  return lines;
}

function formatSeverityCounts(report: ValidationReport): string {
  const critical = report.results.filter(
    (result) =>
      result.severity === 'critical' && (result.status === 'fail' || result.status === 'error'),
  ).length;
  const high = report.results.filter(
    (result) =>
      result.severity === 'high' && (result.status === 'fail' || result.status === 'error'),
  ).length;
  const warning = report.results.filter((result) => result.status === 'warn').length;
  return `${critical} critical | ${high} high | ${warning} warning${warning === 1 ? '' : 's'}`;
}

function sortFailures(
  results: readonly WeightedValidationResult[],
): readonly WeightedValidationResult[] {
  return [...results].sort(
    (left, right) =>
      right.weight - left.weight ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.nodeId.localeCompare(right.nodeId),
  );
}

function renderEvidenceSummary(report: ValidationReport): readonly string[] {
  const summary = hasEvidenceSummary(report)
    ? report.evidenceSummary
    : summarizeEvidenceMaturity(report.results);
  if (summary.total === 0) {
    return [];
  }

  const lines = [
    '',
    `Evidence: ${summary.counts.observed} observed, ${summary.counts.tested} tested, ${summary.counts.expired} expired`,
  ];
  if (summary.counts.expired > 0) {
    lines.push(
      `  ${theme.warn(`${summary.counts.expired} expired test result${summary.counts.expired === 1 ? '' : 's'} - run 'stronghold evidence list' for details`)}`,
    );
  }
  return lines;
}

function hasEvidenceSummary(
  report: ValidationReport,
): report is ValidationReport & {
  readonly evidenceSummary: ReturnType<typeof summarizeEvidenceMaturity>;
} {
  return 'evidenceSummary' in report;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${(durationMs / 60_000).toFixed(1)}m`;
}

function formatTimeout(timeoutMs: number): string {
  return `${Math.round(timeoutMs / 1000)}s`;
}

function renderTemporalDeltaLines(
  results: ScanResults,
  postureDelta:
    | {
        readonly currentSnapshot: ScanSnapshot | null;
        readonly previousSnapshot: ScanSnapshot | null;
        readonly lifecycleDelta: FindingLifecycleDelta | null;
      }
    | undefined,
): readonly string[] {
  const currentSnapshot = postureDelta?.currentSnapshot;
  const previousSnapshot = postureDelta?.previousSnapshot;
  const lifecycleDelta = postureDelta?.lifecycleDelta;
  if (!currentSnapshot) {
    return [];
  }

  const scoreDelta = currentSnapshot.globalScore - (previousSnapshot?.globalScore ?? currentSnapshot.globalScore);
  const scenarioDelta =
    currentSnapshot.scenarioCoverage.covered -
    (previousSnapshot?.scenarioCoverage.covered ?? currentSnapshot.scenarioCoverage.covered);

  return [
    `  Score: ${currentSnapshot.globalScore}/100 (${currentSnapshot.globalGrade}) ${formatScoreDelta(scoreDelta, previousSnapshot != null)}`,
    `  Findings: ${currentSnapshot.totalFindings}${formatFindingDelta(lifecycleDelta)}`,
    `  Scenarios: ${currentSnapshot.scenarioCoverage.covered}/${currentSnapshot.scenarioCoverage.total} covered ${formatScenarioDelta(scenarioDelta, previousSnapshot != null)}`,
  ];
}

function formatScoreDelta(scoreDelta: number, hasPreviousSnapshot: boolean): string {
  if (!hasPreviousSnapshot) {
    return '- first scan';
  }
  if (scoreDelta > 0) {
    return `^ +${scoreDelta} from last scan`;
  }
  if (scoreDelta < 0) {
    return `v ${scoreDelta} from last scan`;
  }
  return '- unchanged';
}

function formatFindingDelta(lifecycleDelta: FindingLifecycleDelta | null | undefined): string {
  if (!lifecycleDelta) {
    return '';
  }

  const parts = [
    `${lifecycleDelta.summary.newCount} new`,
    `${lifecycleDelta.summary.resolvedCount} resolved`,
    `${lifecycleDelta.summary.recurrentCount} recurrent`,
  ];
  return ` (${parts.join(', ')})`;
}

function formatScenarioDelta(scenarioDelta: number, hasPreviousSnapshot: boolean): string {
  if (!hasPreviousSnapshot) {
    return '(first scan)';
  }
  if (scenarioDelta > 0) {
    return `(+${scenarioDelta} from last scan)`;
  }
  if (scenarioDelta < 0) {
    return `(${scenarioDelta} from last scan)`;
  }
  return '(unchanged)';
}
