import {
  selectDefaultScenarios,
  type CoverageDetail,
  type CoverageVerdict,
  type Scenario,
  type ScenarioAnalysis,
  type ScenarioCoverageSummary,
  type ScenarioType,
  type ServiceScenarioImpact,
} from '@stronghold-dr/core';

import type { ScanResults } from '../storage/file-store.js';
import { theme } from './theme.js';

const SCENARIO_TYPE_LABELS: Readonly<Record<ScenarioType, string>> = {
  az_failure: 'AZ Failure Scenarios',
  region_failure: 'Region Failure Scenarios',
  service_outage: 'Service Outage Scenarios',
  node_failure: 'SPOF Failure Scenarios',
  data_corruption: 'Data Corruption Scenarios',
  custom: 'Custom Scenarios',
};

const SCENARIO_TYPE_ORDER: Readonly<Record<ScenarioType, number>> = {
  az_failure: 0,
  region_failure: 1,
  node_failure: 2,
  data_corruption: 3,
  service_outage: 4,
  custom: 5,
};

const COVERAGE_VERDICT_ORDER: Readonly<Record<CoverageVerdict, number>> = {
  uncovered: 0,
  degraded: 1,
  partially_covered: 2,
  covered: 3,
};

export function getScenarioAnalysis(scan: ScanResults): ScenarioAnalysis | null {
  return scan.scenarioAnalysis ?? null;
}

export function getRenderedScenarios(
  analysis: ScenarioAnalysis,
  options: {
    readonly showAll?: boolean;
  } = {},
): readonly Scenario[] {
  const scenarios = options.showAll ? analysis.scenarios : selectDefaultScenarios(analysis);
  return scenarios.slice().sort(compareScenarios);
}

export function renderScenarioCoverageLine(summary: ScenarioCoverageSummary): string | null {
  if (summary.total === 0) {
    return null;
  }

  return `Scenario coverage: ${summary.covered}/${summary.total} covered, ${summary.partiallyCovered} partial, ${summary.uncovered} uncovered${summary.degraded > 0 ? `, ${summary.degraded} degraded` : ''}`;
}

export function renderScenarioCoverageHeadline(scan: ScanResults): string | null {
  const summary = scan.scenarioAnalysis?.summary;
  if (!summary || summary.total === 0) {
    return null;
  }

  return `Global DR score: ${scan.validationReport.scoreBreakdown.overall}/100 (${scan.validationReport.scoreBreakdown.grade}) - ${summary.covered}/${summary.total} scenarios covered`;
}

export function renderScenarioCoverageSection(
  analysis: ScenarioAnalysis | null | undefined,
  format: 'terminal' | 'markdown',
): string {
  if (!analysis || analysis.summary.total === 0) {
    return '';
  }

  const scenarios = getRenderedScenarios(analysis);
  const summary = analysis.summary;
  const priorityGaps = selectPriorityCoverageGaps(scenarios, 3);

  if (format === 'markdown') {
    const lines = [
      '## Scenario Coverage',
      '',
      `- Covered: ${summary.covered}/${summary.total}`,
      `- Partial: ${summary.partiallyCovered}/${summary.total}`,
      `- Uncovered: ${summary.uncovered}/${summary.total}`,
      `- Degraded: ${summary.degraded}/${summary.total}`,
      '',
      '| Scenario | Type | Affected services | Verdict |',
      '| --- | --- | ---: | --- |',
      ...scenarios.map(
        (scenario) =>
          `| ${scenario.name} | ${formatScenarioTypeTag(scenario.type)} | ${countAffectedServices(scenario)} | ${formatCoverageVerdictText(scenario.coverage?.verdict)} |`,
      ),
    ];

    if (priorityGaps.length > 0) {
      lines.push('');
      lines.push('### Critical uncovered scenarios');
      lines.push('');
      priorityGaps.forEach((scenario) => {
        lines.push(`1. ${renderScenarioGapSummary(scenario)}`);
      });
    }

    lines.push('');
    lines.push("Run 'stronghold scenarios' for full analysis.");
    return lines.join('\n');
  }

  const lines = [
    theme.section('Scenario Coverage'),
    `Covered:      ${summary.covered}/${summary.total}`,
    `Partial:      ${summary.partiallyCovered}/${summary.total}`,
    `Uncovered:    ${summary.uncovered}/${summary.total}`,
    `Degraded:     ${summary.degraded}/${summary.total}`,
  ];

  if (priorityGaps.length > 0) {
    lines.push('');
    lines.push('Critical uncovered scenarios:');
    priorityGaps.forEach((scenario, index) => {
      lines.push(`  ${index + 1}. ${renderScenarioGapSummary(scenario)}`);
    });
  }

  lines.push('');
  lines.push("Run 'stronghold scenarios' for full analysis.");
  return lines.join('\n');
}

export function renderScenarioAnalysis(
  analysis: ScenarioAnalysis,
  timestamp: string,
  options: {
    readonly showAll?: boolean;
  } = {},
): string {
  const scenarios = getRenderedScenarios(analysis, options);
  if (scenarios.length === 0) {
    return `Scenario Coverage Analysis - ${timestamp.slice(0, 10)}\n\nNo disruption impact scenarios were generated for this scan.`;
  }

  const lines = [`Scenario Coverage Analysis - ${timestamp.slice(0, 10)}`, ''];
  const grouped = groupScenariosByType(scenarios);

  for (const [type, entries] of grouped) {
    lines.push(`  ${SCENARIO_TYPE_LABELS[type]}:`);
    entries.forEach((scenario) => {
      const affectedServices = scenario.impact?.serviceImpact.filter(
        (serviceImpact) => serviceImpact.status !== 'unaffected',
      ) ?? [];
      lines.push(
        `    ${formatCoverageIcon(scenario.coverage?.verdict)} ${formatScenarioName(scenario).padEnd(26)} ${String(affectedServices.length).padStart(2)} service${affectedServices.length === 1 ? '' : 's'} affected   ${formatCoverageVerdictLabel(scenario.coverage?.verdict)}`,
      );
      affectedServices.slice(0, 3).forEach((serviceImpact) => {
        const detail = findCoverageDetail(scenario, serviceImpact.serviceId);
        lines.push(
          `      ${serviceImpact.serviceId}: ${formatServiceStatus(serviceImpact.status)} (${formatServiceImpactSummary(serviceImpact)})   ${formatCoverageDetailSummary(detail)}`,
        );
      });
      if (affectedServices.length > 3) {
        lines.push(`      ... ${affectedServices.length - 3} more service impacts`);
      }
      if (affectedServices.length === 0) {
        lines.push('      No services are affected.');
      }
      lines.push('');
    });
  }

  const summaryLine = renderScenarioCoverageLine(analysis.summary);
  if (summaryLine) {
    lines.push(`  Summary: ${summaryLine.replace('Scenario coverage: ', '')}`);
    lines.push('');
  }
  lines.push("  Run 'stronghold scenarios show <id>' for details.");

  return lines.join('\n');
}

export function renderScenarioCatalog(
  analysis: ScenarioAnalysis,
  timestamp: string,
): string {
  const scenarios = getRenderedScenarios(analysis, { showAll: true });
  if (scenarios.length === 0) {
    return `Scenario Coverage Analysis - ${timestamp.slice(0, 10)}\n\nNo disruption impact scenarios were generated for this scan.`;
  }

  const defaults = new Set(analysis.defaultScenarioIds);
  const lines = [`Scenario Coverage Analysis - ${timestamp.slice(0, 10)}`, ''];
  lines.push(`All scenarios (${scenarios.length}):`);
  scenarios.forEach((scenario) => {
    lines.push(
      `  ${scenario.id.padEnd(32)} ${formatCoverageVerdictLabel(scenario.coverage?.verdict).padEnd(18)} ${formatScenarioTypeTag(scenario.type).padEnd(15)} ${defaults.has(scenario.id) ? '[default]' : '[on-demand]'} ${scenario.name}`,
    );
  });
  return lines.join('\n');
}

export function renderScenarioDetail(scenario: Scenario): string {
  const lines = [`Scenario Coverage Analysis - ${scenario.name}`, ''];
  lines.push(`Type: ${formatScenarioTypeTag(scenario.type)}`);
  lines.push(`Coverage: ${formatCoverageVerdictLabel(scenario.coverage?.verdict)}`);
  lines.push(`Description: ${scenario.description}`);
  lines.push(`Disruption: ${scenario.disruption.selectionCriteria}`);
  lines.push('');
  lines.push(
    `Directly affected: ${scenario.impact?.directlyAffected.length ?? 0} | Cascade affected: ${scenario.impact?.cascadeAffected.length ?? 0} | Total nodes: ${scenario.impact?.totalAffectedNodes ?? 0}`,
  );
  lines.push('');
  lines.push('Direct impact chain:');
  if ((scenario.impact?.directlyAffected.length ?? 0) === 0) {
    lines.push('  No directly affected nodes.');
  } else {
    scenario.impact?.directlyAffected.forEach((node) => {
      lines.push(
        `  - ${node.nodeName} (${node.nodeId})${node.serviceId ? ` [service: ${node.serviceId}]` : ''} - ${node.reason}`,
      );
    });
  }
  lines.push('');
  lines.push('Cascade impact chain:');
  if ((scenario.impact?.cascadeAffected.length ?? 0) === 0) {
    lines.push('  No cascading service impact.');
  } else {
    scenario.impact?.cascadeAffected.forEach((node) => {
      lines.push(
        `  - depth ${node.cascadeDepth}: ${node.nodeName} (${node.nodeId})${node.serviceId ? ` [service: ${node.serviceId}]` : ''} - ${node.reason}`,
      );
    });
  }
  lines.push('');
  lines.push('Per-service impact:');
  const affectedServices = scenario.impact?.serviceImpact.filter(
    (serviceImpact) => serviceImpact.status !== 'unaffected',
  ) ?? [];
  if (affectedServices.length === 0) {
    lines.push('  No services are affected.');
  } else {
    affectedServices.forEach((serviceImpact) => {
      lines.push(
        `  - ${serviceImpact.serviceName}: ${formatServiceStatus(serviceImpact.status)} (${formatServiceImpactSummary(serviceImpact)})`,
      );
    });
  }
  lines.push('');
  lines.push('Coverage details:');
  if ((scenario.coverage?.details.length ?? 0) === 0) {
    lines.push(`  ${scenario.coverage?.summary ?? 'No impacted services to evaluate.'}`);
  } else {
    scenario.coverage?.details.forEach((detail) => {
      lines.push(
        `  - ${detail.serviceName}: ${formatCoverageVerdictLabel(detail.verdict)} - ${detail.reason}`,
      );
      if (detail.recoveryPath) {
        lines.push(`    Recovery path: ${detail.recoveryPath}`);
      }
      if (detail.missingCapabilities.length > 0) {
        lines.push(`    Missing capabilities: ${detail.missingCapabilities.join('; ')}`);
      }
      if (detail.lastTested) {
        lines.push(`    Last tested: ${detail.lastTested.slice(0, 10)} (${detail.evidenceLevel})`);
      } else {
        lines.push(`    Evidence level: ${detail.evidenceLevel}`);
      }
    });
  }
  return lines.join('\n');
}

export function buildScenarioNameLookup(
  analysis: ScenarioAnalysis | null | undefined,
): ReadonlyMap<string, string> {
  return new Map((analysis?.scenarios ?? []).map((scenario) => [scenario.id, scenario.name] as const));
}

function groupScenariosByType(
  scenarios: readonly Scenario[],
): ReadonlyArray<readonly [ScenarioType, readonly Scenario[]]> {
  const grouped = new Map<ScenarioType, Scenario[]>();
  scenarios.forEach((scenario) => {
    const current = grouped.get(scenario.type) ?? [];
    current.push(scenario);
    grouped.set(scenario.type, current);
  });

  return Array.from(grouped.entries()).sort(
    ([leftType], [rightType]) => SCENARIO_TYPE_ORDER[leftType] - SCENARIO_TYPE_ORDER[rightType],
  );
}

function compareScenarios(left: Scenario, right: Scenario): number {
  return (
    COVERAGE_VERDICT_ORDER[left.coverage?.verdict ?? 'covered'] -
      COVERAGE_VERDICT_ORDER[right.coverage?.verdict ?? 'covered'] ||
    SCENARIO_TYPE_ORDER[left.type] - SCENARIO_TYPE_ORDER[right.type] ||
    left.name.localeCompare(right.name)
  );
}

function formatScenarioName(scenario: Scenario): string {
  return scenario.type === 'az_failure'
    ? scenario.name.replace(/^AZ failure - /, '') + ' failure'
    : scenario.type === 'region_failure'
      ? scenario.name.replace(/^Region failure - /, '') + ' failure'
      : scenario.type === 'node_failure'
        ? scenario.name.replace(/^SPOF failure - /, '') + ' fails'
        : scenario.name;
}

function countAffectedServices(scenario: Scenario): number {
  return scenario.impact?.serviceImpact.filter((serviceImpact) => serviceImpact.status !== 'unaffected').length ?? 0;
}

function findCoverageDetail(
  scenario: Scenario,
  serviceId: string,
): CoverageDetail | undefined {
  return scenario.coverage?.details.find((detail) => detail.serviceId === serviceId);
}

function formatCoverageVerdictLabel(
  verdict: CoverageVerdict | undefined,
): string {
  const label = formatCoverageVerdictText(verdict);
  switch (verdict) {
    case 'covered':
      return theme.pass(label);
    case 'partially_covered':
      return theme.warn(label);
    case 'degraded':
      return theme.warn(label);
    case 'uncovered':
      return theme.fail(label);
    default:
      return theme.dim(label);
  }
}

function formatCoverageVerdictText(
  verdict: CoverageVerdict | undefined,
): string {
  return verdict ? verdict.replace('_', ' ').toUpperCase() : 'UNKNOWN';
}

function formatCoverageIcon(verdict: CoverageVerdict | undefined): string {
  switch (verdict) {
    case 'covered':
      return theme.pass('v');
    case 'partially_covered':
      return theme.warn('~');
    case 'degraded':
      return theme.warn('!');
    case 'uncovered':
      return theme.fail('x');
    default:
      return theme.dim('-');
  }
}

function formatScenarioTypeTag(type: ScenarioType): string {
  switch (type) {
    case 'az_failure':
      return 'AZ failure';
    case 'region_failure':
      return 'Region failure';
    case 'service_outage':
      return 'Service outage';
    case 'node_failure':
      return 'SPOF failure';
    case 'data_corruption':
      return 'Data corruption';
    case 'custom':
    default:
      return 'Custom';
  }
}

function formatServiceStatus(
  status: ServiceScenarioImpact['status'],
): string {
  switch (status) {
    case 'down':
      return theme.fail('DOWN');
    case 'degraded':
      return theme.warn('DEGRADED');
    case 'unaffected':
    default:
      return theme.pass('UNAFFECTED');
  }
}

function formatServiceImpactSummary(
  impact: ServiceScenarioImpact,
): string {
  if (impact.criticalResourcesAffected.length > 0) {
    return impact.criticalResourcesAffected.join(', ');
  }
  return `${impact.affectedResources}/${impact.totalResources} resources`;
}

function formatCoverageDetailSummary(detail: CoverageDetail | undefined): string {
  if (!detail) {
    return 'coverage details unavailable';
  }

  if (detail.recoveryPath && detail.verdict === 'covered') {
    return `${detail.recoveryPath}${detail.lastTested ? ` (tested ${detail.lastTested.slice(0, 10)})` : ''}`;
  }
  if (detail.recoveryPath && detail.verdict === 'partially_covered') {
    return `${detail.reason} Recovery path: ${detail.recoveryPath}`;
  }
  return detail.reason;
}

function selectPriorityCoverageGaps(
  scenarios: readonly Scenario[],
  limit: number,
): readonly Scenario[] {
  return scenarios
    .filter((scenario) => scenario.coverage?.verdict === 'uncovered' || scenario.coverage?.verdict === 'degraded')
    .slice()
    .sort(
      (left, right) =>
        countDownServices(right) - countDownServices(left) ||
        countAffectedServices(right) - countAffectedServices(left) ||
        SCENARIO_TYPE_ORDER[left.type] - SCENARIO_TYPE_ORDER[right.type] ||
        left.name.localeCompare(right.name),
    )
    .slice(0, limit);
}

function countDownServices(scenario: Scenario): number {
  return scenario.impact?.serviceImpact.filter((serviceImpact) => serviceImpact.status === 'down').length ?? 0;
}

function renderScenarioGapSummary(scenario: Scenario): string {
  const uncoveredDetail =
    scenario.coverage?.details.find((detail) => detail.verdict === 'uncovered') ??
    scenario.coverage?.details.find((detail) => detail.verdict === 'degraded') ??
    scenario.coverage?.details[0];

  if (uncoveredDetail) {
    return `${scenario.name} - ${uncoveredDetail.serviceName} service ${uncoveredDetail.reason.charAt(0).toLowerCase()}${uncoveredDetail.reason.slice(1)}`;
  }

  if ((scenario.impact?.cascadeAffected.length ?? 0) > 0) {
    return `${scenario.name} - cascade affects ${scenario.impact?.cascadeAffected.length ?? 0} resources`;
  }

  return `${scenario.name} - ${scenario.coverage?.summary ?? 'no recovery path identified'}`;
}
