import type {
  DriftImpactAnalysis,
  DriftReport,
  ValidationReport,
  WeightedValidationResult,
} from '@stronghold-dr/core';

export interface DriftFindingDelta {
  readonly ruleId: string;
  readonly nodeId: string;
  readonly nodeName: string;
  readonly severity: WeightedValidationResult['severity'];
  readonly status: WeightedValidationResult['status'];
  readonly message: string;
}

export interface DriftCheckReport {
  readonly hasDrift: boolean;
  readonly baselineCreated: boolean;
  readonly scoreBefore: number | null;
  readonly scoreAfter: number;
  readonly scoreDelta: number;
  readonly newFindings: readonly DriftFindingDelta[];
  readonly resolvedFindings: readonly DriftFindingDelta[];
  readonly drpImpact: DriftImpactAnalysis['impacts'];
  readonly driftCount: number;
  readonly timestamp: string;
  readonly message: string;
  readonly drpStatus: DriftImpactAnalysis['status'];
  readonly affectedSections: readonly string[];
}

const NEGATIVE_STATUSES = new Set<WeightedValidationResult['status']>(['fail', 'warn', 'error']);
const SEVERITY_ORDER: Record<WeightedValidationResult['severity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};
const IMPACT_ORDER = {
  invalidated: 3,
  degraded: 2,
  informational: 1,
} as const;

export function isCiEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.CI === 'true' ||
    env.GITHUB_ACTIONS === 'true' ||
    env.GITLAB_CI === 'true' ||
    typeof env.JENKINS_URL === 'string'
  );
}

export function buildDriftCheckReport(params: {
  readonly baselineValidation?: ValidationReport | null;
  readonly currentValidation: ValidationReport;
  readonly driftReport: DriftReport;
  readonly drpImpact: DriftImpactAnalysis;
  readonly baselineCreated?: boolean;
  readonly message?: string;
}): DriftCheckReport {
  const baselineValidation = params.baselineValidation ?? null;
  const scoreBefore = baselineValidation?.score ?? null;
  const scoreAfter = params.currentValidation.score;
  const scoreDelta = scoreBefore === null ? 0 : scoreAfter - scoreBefore;

  return {
    hasDrift: params.driftReport.summary.total > 0,
    baselineCreated: params.baselineCreated ?? false,
    scoreBefore,
    scoreAfter,
    scoreDelta,
    newFindings:
      baselineValidation === null
        ? []
        : diffFindings(baselineValidation.results, params.currentValidation.results, 'new'),
    resolvedFindings:
      baselineValidation === null
        ? []
        : diffFindings(baselineValidation.results, params.currentValidation.results, 'resolved'),
    drpImpact: params.drpImpact.impacts,
    driftCount: params.driftReport.summary.total,
    timestamp: params.driftReport.timestamp.toISOString(),
    message:
      params.message ??
      (params.baselineCreated
        ? 'No baseline found. Saved current scan as baseline.'
        : params.drpImpact.message),
    drpStatus: params.drpImpact.status,
    affectedSections: params.drpImpact.affectedSections,
  };
}

export function determineDriftExitCode(
  report: DriftCheckReport,
  failThreshold = 1,
): number {
  if (report.baselineCreated) {
    return 0;
  }
  const scoreDecrease = report.scoreDelta < 0 ? Math.abs(report.scoreDelta) : 0;
  const hasDrpImpact = report.drpImpact.some((impact) => impact.impact !== 'informational');
  if (scoreDecrease >= failThreshold || hasDrpImpact) {
    return 1;
  }
  return 0;
}

export function renderDriftCheckTerminalReport(
  report: DriftCheckReport,
  driftReport: DriftReport,
  baselineTimestamp?: string,
): string {
  const lines: string[] = [];

  if (report.baselineCreated) {
    lines.push(report.message);
    return lines.join('\n');
  }

  if (!report.hasDrift) {
    lines.push(
      baselineTimestamp
        ? `No drift detected since baseline (${baselineTimestamp}).`
        : 'No drift detected.',
    );
  } else {
    lines.push(
      baselineTimestamp
        ? `Drift detected since baseline (${baselineTimestamp}): ${report.driftCount} change${report.driftCount === 1 ? '' : 's'}.`
        : `Drift detected: ${report.driftCount} change${report.driftCount === 1 ? '' : 's'}.`,
    );
  }

  if (report.scoreBefore !== null) {
    lines.push(`DR score: ${report.scoreBefore} -> ${report.scoreAfter} (${formatSignedDelta(report.scoreDelta)})`);
  } else {
    lines.push(`DR score: ${report.scoreAfter}`);
  }

  if (report.newFindings.length > 0 || report.resolvedFindings.length > 0) {
    lines.push(
      `Findings: ${report.newFindings.length} new, ${report.resolvedFindings.length} resolved`,
    );
  }

  if (driftReport.changes.length > 0) {
    lines.push('');
    lines.push('Top Drift Changes');
    driftReport.changes.slice(0, 5).forEach((change) => {
      lines.push(`- [${change.severity.toUpperCase()}] ${change.description}`);
      lines.push(`  DR impact: ${change.drImpact}`);
    });
  }

  if (report.drpImpact.length > 0) {
    lines.push('');
    lines.push('DRP Impact Analysis');
    report.drpImpact.forEach((impact) => {
      lines.push(`- [${impact.impact.toUpperCase()}] ${impact.nodeName}`);
      if (impact.drpSections.length > 0) {
        lines.push(`  DRP section${impact.drpSections.length === 1 ? '' : 's'}: ${impact.drpSections.join(', ')}`);
      }
      lines.push(`  ${impact.message}`);
      if (impact.estimatedRtoChange) {
        const sourceSuffix = impact.estimatedRtoChange.source
          ? ` (source: ${impact.estimatedRtoChange.source})`
          : '';
        lines.push(
          `  RTO impact: ${formatRtoChange(impact.estimatedRtoChange.before, impact.estimatedRtoChange.after)}${sourceSuffix}`,
        );
      }
    });
  }

  lines.push('');
  lines.push(report.message);
  if (report.drpStatus === 'stale') {
    lines.push("Run 'stronghold plan generate' to regenerate the DRP.");
  }

  return lines.join('\n');
}

export function formatGitHubActionsAnnotations(
  report: DriftCheckReport,
  maxAnnotations = 5,
): readonly string[] {
  if (report.baselineCreated || (!report.hasDrift && report.drpImpact.length === 0)) {
    return [];
  }

  const annotations: string[] = [];
  if (report.scoreBefore !== null && report.scoreDelta < 0) {
    const criticalFindings = report.newFindings.filter((finding) => finding.severity === 'critical').length;
    annotations.push(
      formatAnnotation(
        'warning',
        'DR Score Decreased',
        `Score dropped from ${report.scoreBefore} to ${report.scoreAfter} (${formatSignedDelta(report.scoreDelta)}). ${criticalFindings} new critical findings.`,
      ),
    );
  }

  report.drpImpact
    .filter((impact) => impact.impact !== 'informational')
    .sort(
      (left, right) =>
        IMPACT_ORDER[right.impact] - IMPACT_ORDER[left.impact] ||
        left.nodeName.localeCompare(right.nodeName),
    )
    .forEach((impact) => {
      if (annotations.length >= maxAnnotations) {
        return;
      }
      annotations.push(
        formatAnnotation(
          impact.impact === 'invalidated' ? 'error' : 'warning',
          impact.impact === 'invalidated' ? 'DRP Invalidated' : 'DRP Degraded',
          impact.message,
        ),
      );
    });

  report.newFindings
    .filter((finding) => finding.severity === 'critical' || finding.severity === 'high')
    .forEach((finding) => {
      if (annotations.length >= maxAnnotations) {
        return;
      }
      annotations.push(
        formatAnnotation(
          finding.severity === 'critical' ? 'error' : 'warning',
          'New DR Finding',
          `${finding.ruleId} on ${finding.nodeName}: ${finding.message}`,
        ),
      );
    });

  return annotations.slice(0, maxAnnotations);
}

function diffFindings(
  baseline: readonly WeightedValidationResult[],
  current: readonly WeightedValidationResult[],
  mode: 'new' | 'resolved',
): readonly DriftFindingDelta[] {
  const baselineMap = new Map(
    baseline.map((result) => [toFindingKey(result), result] as const),
  );
  const currentMap = new Map(
    current.map((result) => [toFindingKey(result), result] as const),
  );
  const target = mode === 'new' ? current : baseline;

  return target
    .filter((result) => NEGATIVE_STATUSES.has(result.status))
    .filter((result) =>
      mode === 'new'
        ? !NEGATIVE_STATUSES.has(baselineMap.get(toFindingKey(result))?.status ?? 'pass')
        : !NEGATIVE_STATUSES.has(currentMap.get(toFindingKey(result))?.status ?? 'pass'),
    )
    .map((result) => ({
      ruleId: result.ruleId,
      nodeId: result.nodeId,
      nodeName: result.nodeName,
      severity: result.severity,
      status: result.status,
      message: result.message,
    }))
    .sort(compareFindingDeltas);
}

function toFindingKey(result: Pick<WeightedValidationResult, 'ruleId' | 'nodeId'>): string {
  return `${result.ruleId}:${result.nodeId}`;
}

function compareFindingDeltas(left: DriftFindingDelta, right: DriftFindingDelta): number {
  return (
    SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity] ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.nodeId.localeCompare(right.nodeId)
  );
}

function formatSignedDelta(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

function formatRtoChange(before: string | null, after: string | null): string {
  const beforeLabel = before ?? 'unknown (was already unverified)';
  const afterLabel = after ?? 'unknown';
  return `${beforeLabel} -> ${afterLabel}`;
}

function formatAnnotation(level: 'warning' | 'error', title: string, message: string): string {
  return `::${level} title=${escapeAnnotation(title)}::${escapeAnnotation(message)}`;
}

function escapeAnnotation(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
