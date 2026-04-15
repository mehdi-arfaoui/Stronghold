import chalk from 'chalk';

import type {
  FullChainResult,
  ProofOfRecoveryResult,
  RealityGapResult,
  Recommendation,
  ScenarioAnalysis,
  ServicePostureService,
  ServiceRecommendationProjection,
  TrendDirection,
} from '@stronghold-dr/core';

const COLUMN_WIDTH = 31;
const MAX_REASON_LENGTH = 60;
const SEPARATOR_LENGTH = 62;
const HEALTHY_GRADES = new Set(['A', 'B']);

export interface ExecutiveSummaryOptions {
  readonly score: number;
  readonly grade: string;
  readonly fullChainCoverage: FullChainResult | null | undefined;
  readonly proofOfRecovery: ProofOfRecoveryResult | null | undefined;
  readonly realityGap: RealityGapResult | null | undefined;
  readonly services: readonly ServicePostureService[];
  readonly scenarioAnalysis?: ScenarioAnalysis | null;
  readonly scenariosCovered: number;
  readonly scenariosTotal: number;
  readonly drDebt: number;
  readonly drDebtChange: number | null;
  readonly trend: 'improving' | 'stable' | 'degrading' | 'first_scan';
  readonly nextAction?: Recommendation | ServiceRecommendationProjection | null;
}

export function calculateDebtChangePercent(
  currentDebt: number,
  previousDebt: number | null | undefined,
): number | null {
  if (typeof previousDebt !== 'number' || previousDebt <= 0 || currentDebt <= 0) {
    return null;
  }

  return Math.round(((currentDebt - previousDebt) / previousDebt) * 100);
}

export function resolveExecutiveTrend(
  snapshotCount: number,
  direction: TrendDirection | null | undefined,
): ExecutiveSummaryOptions['trend'] {
  if (snapshotCount < 2 || !direction) {
    return 'first_scan';
  }
  return direction;
}

export function resolveExecutiveTrendFromSnapshots(
  currentScore: number | null | undefined,
  previousScore: number | null | undefined,
): ExecutiveSummaryOptions['trend'] {
  if (typeof currentScore !== 'number' || typeof previousScore !== 'number') {
    return 'first_scan';
  }
  if (currentScore > previousScore) {
    return 'improving';
  }
  if (currentScore < previousScore) {
    return 'degrading';
  }
  return 'stable';
}

export function renderExecutiveSummary(options: ExecutiveSummaryOptions): string {
  const lines = [`  ${chalk.bold('Stronghold DR Intelligence')}`, ''];
  const recoveryChainValue = formatRecoveryChainSummary(
    options.fullChainCoverage,
    options.proofOfRecovery,
  );
  const gapValue = formatRealityGap(options.realityGap, options.services.length);

  lines.push(renderWideMetric('Reality Gap', gapValue.rendered, gapValue.noteRendered));
  lines.push(
    renderMetricRow(
      metricColumn(
        'Score',
        `${options.score}/100 (${options.grade})`,
        colorScore(`${options.score}/100 (${options.grade})`, options.grade),
      ),
      metricColumn('Recovery Chain', recoveryChainValue.plain, recoveryChainValue.rendered),
    ),
  );
  lines.push(
    renderMetricRow(
      metricColumn('Services', `${options.services.length} detected`, `${options.services.length} detected`),
      metricColumn(
        'Scenarios',
        `${options.scenariosCovered}/${options.scenariosTotal} covered`,
        `${options.scenariosCovered}/${options.scenariosTotal} covered`,
      ),
    ),
  );
  lines.push(
    renderMetricRow(
      metricColumn('DR Debt', formatDebt(options.drDebt, options.drDebtChange), formatDebt(options.drDebt, options.drDebtChange)),
      metricColumn('Trend', formatTrendLabel(options.trend), colorTrend(formatTrendLabel(options.trend), options.trend)),
    ),
  );
  lines.push('');
  lines.push(...renderExposureSection(options));

  if (options.nextAction) {
    const plainBadge = formatRecommendationBadgePlain(options.nextAction);
    lines.push('');
    lines.push(
      `  ${chalk.dim('Next action')}  ${truncateText(options.nextAction.title, Math.max(16, 72 - plainBadge.length - 1))} ${formatRecommendationBadge(options.nextAction)}`,
    );
  }

  lines.push('');
  lines.push(`  ${chalk.gray('-'.repeat(SEPARATOR_LENGTH))}`);

  return lines.join('\n');
}

function renderExposureSection(options: ExecutiveSummaryOptions): readonly string[] {
  if (options.services.length === 0) {
    return [`  No services detected - run ${chalk.cyan("'stronghold services detect'")}`];
  }

  const exposedServices = options.services
    .filter((service) => !HEALTHY_GRADES.has(service.score.grade))
    .sort(
      (left, right) =>
        left.score.score - right.score.score ||
        severityScore(right) - severityScore(left) ||
        left.service.id.localeCompare(right.service.id),
    )
    .slice(0, 3);

  if (exposedServices.length === 0) {
    return [`  ${chalk.green('All services healthy')}`];
  }

  const proofByService = new Map(
    (options.proofOfRecovery?.perService ?? []).map((service) => [service.serviceId, service] as const),
  );
  const staleRunbookServices = collectStaleRunbookServices(options.scenarioAnalysis);
  const lines = ['  Worst exposed'];

  exposedServices.forEach((service) => {
    const scoreLabel = `${service.score.grade}  ${String(service.score.score).padStart(3)}/100`;
    lines.push(
      `    ${chalk.red('✗')} ${truncateText(service.service.id, 12).padEnd(12)} ${colorScore(
        scoreLabel,
        service.score.grade,
      )}   ${buildServiceReason(
        service,
        proofByService.get(service.service.id),
        staleRunbookServices.has(service.service.id),
      )}`,
    );
  });

  return lines;
}

function buildServiceReason(
  service: ServicePostureService,
  proof: ProofOfRecoveryResult['perService'][number] | undefined,
  hasStaleRunbook: boolean,
): string {
  const primaryFinding = service.score.findings[0];
  const baseReason = primaryFinding
    ? describeFinding(primaryFinding.category, primaryFinding.ruleId, primaryFinding.message, proof)
    : 'coverage gap';
  const suffixes: string[] = [];

  if (service.score.findings.some((finding) => resolveEvidenceType(finding) === 'expired')) {
    suffixes.push('evidence expired');
  }
  if (hasStaleRunbook) {
    suffixes.push('stale runbook');
  }

  return truncateText(joinReason(baseReason, suffixes), MAX_REASON_LENGTH);
}

function describeFinding(
  category: ServicePostureService['score']['findings'][number]['category'],
  ruleId: string,
  message: string,
  proof: ProofOfRecoveryResult['perService'][number] | undefined,
): string {
  if (category === 'backup') {
    return proof && proof.totalRuleCount > 0 && !proof.hasTestedEvidence
      ? 'no tested restore path'
      : 'no backup';
  }
  if (category === 'redundancy') {
    const normalized = `${ruleId} ${message}`.toLowerCase();
    return normalized.includes('single') || normalized.includes('spof')
      ? 'single point of failure'
      : 'no redundancy';
  }
  if (category === 'replication') {
    return 'no cross-region replication';
  }
  if (category === 'failover') {
    return 'no failover configured';
  }
  if (category === 'detection') {
    return 'no failure detection';
  }
  if (category === 'recovery') {
    return 'no recovery path';
  }

  return truncateText(message.toLowerCase(), MAX_REASON_LENGTH);
}

function joinReason(baseReason: string, suffixes: readonly string[]): string {
  if (suffixes.length === 0) {
    return baseReason;
  }

  let combined = baseReason;
  suffixes.forEach((suffix) => {
    const candidate = `${combined} | ${suffix}`;
    if (candidate.length <= MAX_REASON_LENGTH) {
      combined = candidate;
    }
  });
  return combined;
}

function collectStaleRunbookServices(
  scenarioAnalysis: ScenarioAnalysis | null | undefined,
): ReadonlySet<string> {
  return new Set(
    (scenarioAnalysis?.scenarios ?? []).flatMap((scenario) =>
      (scenario.coverage?.details ?? [])
        .filter((detail) => detail.verdict === 'degraded' && detail.reason.toLowerCase().includes('stale'))
        .map((detail) => detail.serviceId),
    ),
  );
}

function resolveEvidenceType(
  finding: ServicePostureService['score']['findings'][number],
): string | null {
  if ('weightBreakdown' in finding && 'evidenceType' in finding.weightBreakdown) {
    const evidenceType = (finding.weightBreakdown as { readonly evidenceType?: unknown }).evidenceType;
    return typeof evidenceType === 'string' ? evidenceType : null;
  }
  return null;
}

function severityScore(service: ServicePostureService): number {
  return (
    service.score.findingsCount.critical * 4 +
    service.score.findingsCount.high * 3 +
    service.score.findingsCount.medium * 2 +
    service.score.findingsCount.low
  );
}

function formatRecommendationBadge(
  recommendation: Recommendation | ServiceRecommendationProjection,
): string {
  const riskLabel = recommendation.risk.toUpperCase();
  const coloredRisk =
    recommendation.risk === 'safe'
      ? chalk.green(riskLabel)
      : recommendation.risk === 'caution'
        ? chalk.yellow(riskLabel)
        : chalk.red(riskLabel);
  const points = `${recommendation.impact.scoreDelta >= 0 ? '+' : ''}${recommendation.impact.scoreDelta} ${
    Math.abs(recommendation.impact.scoreDelta) === 1 ? 'point' : 'points'
  }`;

  return `[${coloredRisk} | ${points}]`;
}

function formatRecommendationBadgePlain(
  recommendation: Recommendation | ServiceRecommendationProjection,
): string {
  const riskLabel = recommendation.risk.toUpperCase();
  const points = `${recommendation.impact.scoreDelta >= 0 ? '+' : ''}${recommendation.impact.scoreDelta} ${
    Math.abs(recommendation.impact.scoreDelta) === 1 ? 'point' : 'points'
  }`;

  return `[${riskLabel} | ${points}]`;
}

function formatRecoveryChainSummary(
  fullChainCoverage: FullChainResult | null | undefined,
  proof: ProofOfRecoveryResult | null | undefined,
): { readonly plain: string; readonly rendered: string } {
  if (fullChainCoverage) {
    const totalSteps = fullChainCoverage.chains.reduce((sum, chain) => sum + chain.totalSteps, 0);
    const provenSteps = fullChainCoverage.chains.reduce((sum, chain) => sum + chain.provenSteps, 0);
    const label = `${provenSteps}/${totalSteps} steps proven (${fullChainCoverage.globalWeightedCoverage}% weighted)`;

    return {
      plain: label,
      rendered: colorProof(label, fullChainCoverage.globalWeightedCoverage),
    };
  }

  const tested = proof?.proofOfRecovery;
  const observed = proof?.observedCoverage ?? 0;
  const testedPlain = tested === null || tested === undefined ? 'N/A tested' : `${tested}% tested`;
  const testedRendered =
    tested === null || tested === undefined
      ? chalk.gray('N/A tested')
      : colorProof(`${tested}% tested`, tested);

  return {
    plain: `N/A (${testedPlain} / ${observed}% observed)`,
    rendered: `${chalk.gray('N/A')} ${chalk.gray('(')}${testedRendered} ${chalk.gray('/')} ${observed}% observed${chalk.gray(')')}`,
  };
}

function formatRealityGap(
  realityGap: RealityGapResult | null | undefined,
  serviceCount: number,
): {
  readonly plain: string;
  readonly rendered: string;
  readonly notePlain: string;
  readonly noteRendered: string;
} {
  if (!realityGap || realityGap.provenRecoverability === null || serviceCount === 0) {
    return {
      plain: 'N/A',
      rendered: chalk.gray('N/A'),
      notePlain: 'no services detected',
      noteRendered: chalk.gray('no services detected'),
    };
  }

  const gap = realityGap.realityGap ?? Math.max(0, realityGap.claimedProtection - realityGap.provenRecoverability);
  const renderedGap = colorRealityGap(`${gap} pts`, gap);
  const note =
    gap === 0
      ? 'No gap - DR posture is fully proven'
      : `claimed ${realityGap.claimedProtection}% protected -> ${realityGap.provenRecoverability}% proven recoverable`;

  return {
    plain: `${gap} pts`,
    rendered: renderedGap,
    notePlain: note,
    noteRendered: gap === 0 ? chalk.green(note) : chalk.gray(note),
  };
}

function formatDebt(drDebt: number, change: number | null): string {
  const roundedDebt = Math.round(drDebt);
  if (roundedDebt === 0) {
    return '0';
  }
  if (change === null) {
    return String(roundedDebt);
  }
  const prefix = change >= 0 ? '+' : '';
  return `${roundedDebt} (${prefix}${change}%)`;
}

function formatTrendLabel(trend: ExecutiveSummaryOptions['trend']): string {
  if (trend === 'first_scan') {
    return 'first scan';
  }
  return trend;
}

function renderMetricRow(
  left: MetricColumn,
  right: MetricColumn,
): string {
  return `  ${padMetric(left, COLUMN_WIDTH)}  ${right.rendered}`;
}

function renderWideMetric(label: string, value: string, note: string): string {
  return `  ${chalk.dim(label)}  ${value}  ${note}`;
}

function padMetric(column: MetricColumn, width: number): string {
  return `${column.rendered}${' '.repeat(Math.max(0, width - column.plain.length))}`;
}

function metricColumn(label: string, plainValue: string, renderedValue: string): MetricColumn {
  return {
    plain: `${label}  ${plainValue}`,
    rendered: `${chalk.dim(label)}  ${renderedValue}`,
  };
}

function colorScore(value: string, grade: string): string {
  if (grade === 'A' || grade === 'B') {
    return chalk.green(value);
  }
  if (grade === 'C' || grade === 'D') {
    return chalk.yellow(value);
  }
  return chalk.red(value);
}

function colorProof(value: string, percentage: number): string {
  if (percentage === 0) {
    return chalk.red(value);
  }
  if (percentage < 50) {
    return chalk.yellow(value);
  }
  return chalk.green(value);
}

function colorTrend(
  value: string,
  trend: ExecutiveSummaryOptions['trend'],
): string {
  if (trend === 'improving') {
    return chalk.green(value);
  }
  if (trend === 'degrading') {
    return chalk.red(value);
  }
  if (trend === 'first_scan') {
    return chalk.gray(value);
  }
  return chalk.yellow(value);
}

function colorRealityGap(value: string, gap: number): string {
  if (gap === 0) {
    return chalk.green(value);
  }
  if (gap > 50) {
    return chalk.red(value);
  }
  if (gap >= 20) {
    return chalk.yellow(value);
  }
  return chalk.green(value);
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

interface MetricColumn {
  readonly plain: string;
  readonly rendered: string;
}
