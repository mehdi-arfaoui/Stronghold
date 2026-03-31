import type { DRCategory, ValidationReport, WeightedValidationResult } from './validation-types.js';

const CATEGORY_LABELS: Record<DRCategory, string> = {
  backup: 'Backup',
  redundancy: 'Redundancy',
  failover: 'Failover',
  detection: 'Detection',
  recovery: 'Recovery',
  replication: 'Replication',
};

/** Formats a human-readable DR posture report. */
export function formatValidationReport(report: ValidationReport): string {
  const criticalFailures = sortByImpact(
    report.results.filter(
      (result) =>
        result.severity === 'critical' && (result.status === 'fail' || result.status === 'error'),
    ),
  );
  const otherFailures = sortByImpact(
    report.results.filter(
      (result) =>
        result.severity !== 'critical' && (result.status === 'fail' || result.status === 'error'),
    ),
  );
  const warnings = sortByImpact(report.results.filter((result) => result.status === 'warn'));
  const lines = [
    separator(),
    '  STRONGHOLD DR Posture Report',
    `  ${report.timestamp}`,
    separator(),
    '',
    `  DR Posture Score: ${report.scoreBreakdown.overall}/100 (Grade: ${report.scoreBreakdown.grade})`,
    '',
    ...wrapText(report.scoreBreakdown.disclaimer, 54).map((line) => `  ${line}`),
    '',
    ...formatCategoryScores(report),
    '',
    `  Weakest area: ${CATEGORY_LABELS[report.scoreBreakdown.weakestCategory]}`,
    '',
    separator(),
    '',
    `  OK ${report.passed} passed   FAIL ${report.failed} failed   WARN ${report.warnings} warning${report.warnings === 1 ? '' : 's'}   SKIP ${report.skipped} skipped   ERR ${report.errors} error${report.errors === 1 ? '' : 's'}`,
  ];

  if (criticalFailures.length > 0) {
    lines.push('', '  CRITICAL FAILURES (highest impact first):', '');
    lines.push(...criticalFailures.flatMap((result) => formatResult('FAIL', result)));
  }

  if (otherFailures.length > 0) {
    lines.push('', '  HIGH FAILURES:', '');
    lines.push(...otherFailures.flatMap((result) => formatResult('FAIL', result)));
  }

  if (warnings.length > 0) {
    lines.push('', '  WARNINGS:', '');
    lines.push(...warnings.flatMap((result) => formatResult('WARN', result)));
  }

  lines.push(
    '',
    separator(),
    `  Scoring: ${report.scoreBreakdown.scoringMethod}`,
    `  ${report.totalChecks} checks across ${report.scannedResources} resources`,
    separator(),
  );

  return lines.join('\n');
}

function formatCategoryScores(report: ValidationReport): readonly string[] {
  return (Object.keys(CATEGORY_LABELS) as DRCategory[]).map((category) => {
    const label = `${CATEGORY_LABELS[category]}:`;
    const score = report.scoreBreakdown.byCategory[category];
    return `  ${label.padEnd(13)} ${String(score).padStart(3)}/100 ${buildBar(score)}`;
  });
}

function formatResult(prefix: string, result: WeightedValidationResult): readonly string[] {
  const lines = [`  ${prefix} ${result.ruleId} - ${result.nodeName}`];
  lines.push(`     ${result.message}`);

  const impactLine = formatImpact(result);
  if (impactLine) lines.push(`     ${impactLine}`);

  const consequence = inferConsequence(result);
  if (consequence) lines.push(`     ${consequence}`);

  lines.push(`     -> ${result.remediation ?? defaultRemediation(result)}`);
  return [...lines, ''];
}

function formatImpact(result: WeightedValidationResult): string | null {
  const count = result.weightBreakdown.directDependentCount;
  if (count <= 0) return null;
  return `Impact: ${count} service${count === 1 ? '' : 's'} depend directly on this resource.`;
}

function inferConsequence(result: WeightedValidationResult): string | null {
  switch (result.ruleId) {
    case 'backup_plan_exists':
      return 'If this resource is lost, data loss is permanent (RPO = infinity).';
    case 'route53_failover_configured':
      return 'Traffic cannot be rerouted automatically - manual DNS changes are required.';
    case 'cloudwatch_alarm_exists':
      return 'An incident on this resource may go undetected, adding to recovery time.';
    case 'elb_multi_az':
      return 'Loss of the remaining availability zone can take down traffic routing.';
    case 'backup_retention_adequate':
      return 'Short retention narrows the recovery window for delayed corruption or deletion events.';
    default:
      return fallbackConsequence(result);
  }
}

function fallbackConsequence(result: WeightedValidationResult): string {
  switch (result.category) {
    case 'backup':
      return result.status === 'warn'
        ? 'Recovery points exist, but the current protection window is weaker than recommended.'
        : 'Recovery points may be missing or too old, increasing the risk of permanent data loss.';
    case 'redundancy':
      return 'A single infrastructure failure can interrupt this component.';
    case 'failover':
      return 'Failover remains manual or slower than expected, extending downtime.';
    case 'detection':
      return 'Incidents may take longer to detect, which pushes recovery time higher.';
    case 'recovery':
      return 'Recovery requires more manual work and is harder to execute consistently.';
    case 'replication':
      return 'Secondary copies or targets are missing, limiting regional recovery options.';
  }
}

function defaultRemediation(result: WeightedValidationResult): string {
  return `Implement the missing ${CATEGORY_LABELS[result.category].toLowerCase()} control for this resource.`;
}

function buildBar(score: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(score / 10)));
  return `${'#'.repeat(filled)}${'.'.repeat(10 - filled)}`;
}

function sortByImpact(results: readonly WeightedValidationResult[]): readonly WeightedValidationResult[] {
  return [...results].sort(
    (left, right) =>
      severityRank(right) - severityRank(left) ||
      right.weight - left.weight ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.nodeId.localeCompare(right.nodeId),
  );
}

function severityRank(result: WeightedValidationResult): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[result.severity];
}

function separator(): string {
  return '=======================================================';
}

function wrapText(text: string, width: number): readonly string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }

    if (current.length > 0) lines.push(current);
    current = word;
  }

  if (current.length > 0) lines.push(current);
  return lines;
}
