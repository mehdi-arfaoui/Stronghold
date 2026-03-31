import type { ValidationReport, WeightedValidationResult } from '@stronghold-dr/core';

import type { ScanResults } from '../storage/file-store.js';
import { formatGrade, theme } from './theme.js';

export function renderScanSummary(
  results: ScanResults,
  options: {
    readonly savedPath?: string;
    readonly warnings?: readonly string[];
  } = {},
): string {
  const lines: string[] = [];
  lines.push(`✅ Scan complete — ${results.regions.length} region${results.regions.length === 1 ? '' : 's'} scanned`);
  lines.push('');
  lines.push(`   Resources discovered:  ${String(results.nodes.length).padStart(3)}`);
  lines.push(`   Dependencies mapped:   ${String(results.edges.length).padStart(3)}`);
  lines.push(`   Services identified:   ${String(results.drpPlan.services.length).padStart(3)}`);
  lines.push('');
  lines.push(`   DR Posture Score:      ${formatGrade(results.validationReport)}`);
  lines.push('');
  lines.push(...renderTopIssues(results.validationReport));
  lines.push('');
  lines.push(`   ${formatSeverityCounts(results.validationReport)}`);

  if (options.savedPath) {
    lines.push('');
    lines.push(`   Results saved to ${options.savedPath}`);
    lines.push(`   Run '${theme.command('stronghold report')}' for full DR posture report`);
    lines.push(`   Run '${theme.command('stronghold plan generate')}' to export DRP as YAML`);
    lines.push(`   Run '${theme.command('stronghold plan runbook')}' to export an executable recovery runbook`);
  }

  if (options.warnings && options.warnings.length > 0) {
    lines.push('');
    lines.push(`   ${theme.warn(`Partial scan — ${options.warnings.length} warning(s). Results may be incomplete.`)}`);
  }

  return lines.join('\n');
}

export function determineSilentExitCode(report: ValidationReport): 0 | 1 {
  return report.score >= 60 ? 0 : 1;
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
    lines.push(`      ${index + 1}. ${issue.ruleId} — ${issue.nodeName}`);
    lines.push(`         ${issue.message}`);
  });
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
  return `${critical} critical · ${high} high · ${warning} warning${warning === 1 ? '' : 's'}`;
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
