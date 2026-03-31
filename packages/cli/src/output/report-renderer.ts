import {
  formatValidationReport,
  type DRCategory,
  type ValidationReport,
  type ValidationSeverity,
  type WeightedValidationResult,
} from '@stronghold-dr/core';

import { buildAsciiBar, formatGrade, formatSeverityLabel, theme } from './theme.js';

export interface ValidationFilters {
  readonly category?: string;
  readonly severity?: string;
}

const CATEGORY_LABELS: Readonly<Record<DRCategory, string>> = {
  backup: 'Backup',
  redundancy: 'Redundancy',
  failover: 'Failover',
  detection: 'Detection',
  recovery: 'Recovery',
  replication: 'Replication',
};

const SEVERITY_RANK: Readonly<Record<ValidationSeverity, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function filterValidationResults(
  report: ValidationReport,
  filters: ValidationFilters,
): readonly WeightedValidationResult[] {
  return report.results
    .filter((result) => {
      if (filters.category && result.category !== filters.category) {
        return false;
      }
      if (!filters.severity) {
        return true;
      }
      return SEVERITY_RANK[result.severity] >= SEVERITY_RANK[filters.severity as ValidationSeverity];
    })
    .sort(compareResults);
}

export function renderTerminalReport(
  report: ValidationReport,
  filters: ValidationFilters,
): string {
  if (!filters.category && !filters.severity && process.env.NO_COLOR) {
    return formatValidationReport(report);
  }

  const filtered = filterValidationResults(report, filters);
  const lines: string[] = [];

  lines.push(theme.section('DR Posture Score'));
  lines.push(`Score: ${formatGrade(report)}`);
  lines.push('');
  lines.push(theme.section('Score by Category'));
  (Object.keys(CATEGORY_LABELS) as DRCategory[]).forEach((category) => {
    const score = report.scoreBreakdown.byCategory[category];
    lines.push(`${CATEGORY_LABELS[category].padEnd(12)} ${String(score).padStart(3)}/100 ${buildAsciiBar(score)}`);
  });

  appendSeveritySection(lines, 'Critical Failures', filtered, ['critical']);
  appendSeveritySection(lines, 'High Failures', filtered, ['high']);
  appendWarningsSection(lines, filtered);

  lines.push('');
  lines.push(theme.section('Methodology'));
  lines.push(report.scoreBreakdown.scoringMethod);
  lines.push(report.scoreBreakdown.disclaimer);

  return lines.join('\n');
}

export function renderMarkdownReport(
  report: ValidationReport,
  filters: ValidationFilters,
): string {
  const filtered = filterValidationResults(report, filters);
  const lines: string[] = [];

  lines.push('## DR Posture Score');
  lines.push('');
  lines.push(`- Score: ${report.scoreBreakdown.overall}/100`);
  lines.push(`- Grade: ${report.scoreBreakdown.grade}`);
  lines.push('');
  lines.push('## Score by Category');
  lines.push('');
  (Object.keys(CATEGORY_LABELS) as DRCategory[]).forEach((category) => {
    lines.push(`- ${CATEGORY_LABELS[category]}: ${report.scoreBreakdown.byCategory[category]}/100`);
  });
  lines.push('');
  lines.push('## Critical Failures');
  lines.push('');
  lines.push(...renderMarkdownFindings(filtered, ['critical']));
  lines.push('');
  lines.push('## High Failures');
  lines.push('');
  lines.push(...renderMarkdownFindings(filtered, ['high']));
  lines.push('');
  lines.push('## Warnings');
  lines.push('');
  lines.push(...renderMarkdownWarnings(filtered));
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(report.scoreBreakdown.scoringMethod);
  lines.push('');
  lines.push(report.scoreBreakdown.disclaimer);

  return lines.join('\n');
}

function appendSeveritySection(
  lines: string[],
  title: string,
  results: readonly WeightedValidationResult[],
  severities: readonly ValidationSeverity[],
): void {
  const findings = results.filter(
    (result) =>
      severities.includes(result.severity) &&
      (result.status === 'fail' || result.status === 'error'),
  );
  lines.push('');
  lines.push(theme.section(title));
  if (findings.length === 0) {
    lines.push('No findings.');
    return;
  }

  findings.forEach((result) => {
    lines.push(`${formatSeverityLabel(result)} ${result.ruleId} — ${result.nodeName}`);
    lines.push(result.message);
    if (result.weightBreakdown.directDependentCount > 0) {
      lines.push(
        `Impact: ${result.weightBreakdown.directDependentCount} service${result.weightBreakdown.directDependentCount === 1 ? '' : 's'} depend directly on this resource.`,
      );
    }
    if (result.remediation) {
      lines.push(`Remediation: ${result.remediation}`);
    }
    lines.push('');
  });
}

function appendWarningsSection(
  lines: string[],
  results: readonly WeightedValidationResult[],
): void {
  lines.push('');
  lines.push(theme.section('Warnings'));
  const warnings = results.filter((result) => result.status === 'warn');
  if (warnings.length === 0) {
    lines.push('No warnings.');
    return;
  }

  warnings.forEach((result) => {
    lines.push(`${theme.warn('warning')} ${result.ruleId} — ${result.nodeName}`);
    lines.push(result.message);
    lines.push('');
  });
}

function renderMarkdownFindings(
  results: readonly WeightedValidationResult[],
  severities: readonly ValidationSeverity[],
): readonly string[] {
  const findings = results.filter(
    (result) =>
      severities.includes(result.severity) &&
      (result.status === 'fail' || result.status === 'error'),
  );
  if (findings.length === 0) {
    return ['No findings.'];
  }

  return findings.flatMap((result) => [
    `- **${result.ruleId}** on \`${result.nodeName}\`: ${result.message}`,
    ...(result.remediation ? [`- Remediation: ${result.remediation}`] : []),
  ]);
}

function renderMarkdownWarnings(
  results: readonly WeightedValidationResult[],
): readonly string[] {
  const warnings = results.filter((result) => result.status === 'warn');
  if (warnings.length === 0) {
    return ['No warnings.'];
  }

  return warnings.map(
    (result) => `- **${result.ruleId}** on \`${result.nodeName}\`: ${result.message}`,
  );
}

function compareResults(
  left: WeightedValidationResult,
  right: WeightedValidationResult,
): number {
  return (
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
    right.weight - left.weight ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.nodeId.localeCompare(right.nodeId)
  );
}
