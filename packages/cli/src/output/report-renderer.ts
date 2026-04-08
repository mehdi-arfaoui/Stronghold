import {
  buildFindingKey,
  checkFreshness,
  EVIDENCE_CONFIDENCE,
  summarizeEvidenceMaturity,
  type FindingLifecycle,
  type ContextualFinding,
  type DRCategory,
  type Evidence,
  type EvidenceMaturitySummary,
  type EvidenceType,
  type ServiceRecommendationProjection,
  type ValidationReport,
  type ValidationReportWithEvidence,
  type ValidationSeverity,
  type WeightedValidationResult,
} from '@stronghold-dr/core';

import type { ScanResults } from '../storage/file-store.js';
import {
  filterContextualFindings,
  formatDeclaredOwnerVerbose,
  formatDetectionSource,
  formatFindingsCount,
  formatFindingSeverity,
  formatMetadataValue,
  hasDetectedServices,
  sortServiceEntries,
} from './service-helpers.js';
import {
  buildScenarioNameLookup,
  renderScenarioCoverageHeadline,
  renderScenarioCoverageLine,
} from './scenario-renderer.js';
import { buildAsciiBar, formatGrade, formatSeverityLabel, theme } from './theme.js';

export interface ReportRenderOptions {
  readonly category?: string;
  readonly severity?: string;
  readonly showPassed?: boolean;
  readonly showResolved?: boolean;
  readonly explainScore?: boolean;
  readonly findingLifecycles?: ReadonlyMap<string, FindingLifecycle>;
  readonly resolvedLifecycles?: readonly FindingLifecycle[];
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
  filters: ReportRenderOptions,
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
  options: ReportRenderOptions,
): string {
  const filtered = filterValidationResults(report, options);
  const lines: string[] = [];
  const findingLifecycles = options.findingLifecycles ?? new Map();

  lines.push(theme.section('DR Posture Score'));
  lines.push(`Score: ${formatGrade(report)}`);
  lines.push('');
  lines.push(theme.section('Score by Category'));
  (Object.keys(CATEGORY_LABELS) as DRCategory[]).forEach((category) => {
    const score = report.scoreBreakdown.byCategory[category];
    lines.push(`${CATEGORY_LABELS[category].padEnd(12)} ${String(score).padStart(3)}/100 ${buildAsciiBar(score)}`);
  });
  appendEvidenceMaturitySection(lines, report);

  appendSeveritySection(lines, 'Critical Failures', filtered, ['critical'], findingLifecycles, new Map());
  appendSeveritySection(lines, 'High Failures', filtered, ['high'], findingLifecycles, new Map());
  appendWarningsSection(lines, filtered, findingLifecycles, new Map());
  if (options.showResolved) {
    appendResolvedFindingsSection(
      lines,
      report.results,
      options.resolvedLifecycles ?? [],
      options,
      new Map(),
    );
  }

  if (options.showPassed) {
    appendVerifiedControlsSection(lines, filtered, new Map());
  }
  if (options.explainScore) {
    appendScoreExplanationSection(lines, filtered, report, new Map());
  }

  lines.push('');
  lines.push(theme.section('Methodology'));
  lines.push(report.scoreBreakdown.scoringMethod);
  lines.push(report.scoreBreakdown.disclaimer);

  return lines.join('\n');
}

export function renderMarkdownReport(
  report: ValidationReport,
  options: ReportRenderOptions,
): string {
  const filtered = filterValidationResults(report, options);
  const lines: string[] = [];
  const findingLifecycles = options.findingLifecycles ?? new Map();

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
  appendMarkdownEvidenceMaturity(lines, report);
  lines.push('');
  lines.push('## Critical Failures');
  lines.push('');
  lines.push(...renderMarkdownFindings(filtered, ['critical'], findingLifecycles, new Map()));
  lines.push('');
  lines.push('## High Failures');
  lines.push('');
  lines.push(...renderMarkdownFindings(filtered, ['high'], findingLifecycles, new Map()));
  lines.push('');
  lines.push('## Warnings');
  lines.push('');
  lines.push(...renderMarkdownWarnings(filtered, findingLifecycles, new Map()));

  if (options.showResolved) {
    lines.push('');
    lines.push('## Resolved Findings');
    lines.push('');
    lines.push(
      ...renderMarkdownResolvedFindings(
        report.results,
        options.resolvedLifecycles ?? [],
        options,
        new Map(),
      ),
    );
  }

  if (options.showPassed) {
    lines.push('');
    lines.push('## Verified Controls');
    lines.push('');
    lines.push(...renderMarkdownVerifiedControls(filtered));
  }
  if (options.explainScore) {
    lines.push('');
    appendMarkdownScoreExplanation(lines, filtered, report, new Map());
  }

  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(report.scoreBreakdown.scoringMethod);
  lines.push('');
  lines.push(report.scoreBreakdown.disclaimer);

  return lines.join('\n');
}

export function renderTerminalServiceReport(
  scan: ScanResults,
  options: ReportRenderOptions,
): string {
  if (!hasDetectedServices(scan.servicePosture)) {
    return `${renderTerminalReport(scan.validationReport, options)}\n\nTip: Organize your resources into services with 'stronghold services detect'`;
  }

  const lines: string[] = [];
  const serviceLabels = buildServiceLookup(scan);
  const findingLifecycles = options.findingLifecycles ?? new Map();
  const scenarioNameById = buildScenarioNameLookup(scan.scenarioAnalysis ?? null);
  const scenarioHeadline = renderScenarioCoverageHeadline(scan);
  const scenarioCoverageLine = scan.scenarioAnalysis
    ? renderScenarioCoverageLine(scan.scenarioAnalysis.summary)
    : null;

  lines.push(theme.section('Executive Summary'));
  lines.push(scenarioHeadline ?? `Global score: ${formatGrade(scan.validationReport)}`);
  if (scenarioCoverageLine) {
    lines.push(scenarioCoverageLine);
  }
  lines.push(`Services detected: ${scan.servicePosture.services.length}`);
  lines.push(
    `Critical services: ${scan.servicePosture.services.filter((service) => service.score.criticality === 'critical').length}`,
  );
  appendEvidenceMaturitySection(lines, scan.validationReport);

  for (const service of sortServiceEntries(scan.servicePosture.services)) {
    lines.push('');
    lines.push(theme.section(`Service: ${service.service.name} (${service.score.grade} - ${service.score.score}/100)`));
    lines.push(`Criticality: ${service.score.criticality}`);
    lines.push(`Owner: ${formatDeclaredOwnerVerbose(service.score.owner)}`);
    lines.push(`Source: ${formatDetectionSource(service.score.detectionSource)}`);
    lines.push(`Resources: ${service.service.resources.length}`);
    lines.push(`Findings: ${formatFindingsCount(service.score.findingsCount)}`);
    appendContextualFindings(
      lines,
      filterContextualFindings(service.contextualFindings, options),
      scenarioNameById,
      findingLifecycles,
    );
    if (options.showResolved) {
      appendResolvedServiceFindings(
        lines,
        service.service.id,
        service.service.name,
        scan.validationReport.results,
        options.resolvedLifecycles ?? [],
        options,
      );
    }
    appendServiceRecommendations(lines, service.recommendations);
  }

  if (scan.servicePosture.unassigned.resourceCount > 0) {
    lines.push('');
    lines.push(theme.section('Unassigned Resources'));
    lines.push(`Resources: ${scan.servicePosture.unassigned.resourceCount}`);
    if (scan.servicePosture.unassigned.score) {
      lines.push(
        `Score: ${scan.servicePosture.unassigned.score.score}/100 (Grade: ${scan.servicePosture.unassigned.score.grade})`,
      );
    }
    appendContextualFindings(
      lines,
      filterContextualFindings(scan.servicePosture.unassigned.contextualFindings, options),
      scenarioNameById,
      findingLifecycles,
    );
    appendServiceRecommendations(lines, scan.servicePosture.unassigned.recommendations);
  }

  lines.push('');
  lines.push(theme.section('Recommendations Summary'));
  appendServiceRecommendations(lines, scan.servicePosture.recommendations);

  if (options.showPassed) {
    appendVerifiedControlsSection(
      lines,
      filterValidationResults(scan.validationReport, options),
      serviceLabels,
    );
  }
  if (options.explainScore) {
    appendScoreExplanationSection(
      lines,
      filterValidationResults(scan.validationReport, options),
      scan.validationReport,
      serviceLabels,
    );
  }

  return lines.join('\n');
}

export function renderMarkdownServiceReport(
  scan: ScanResults,
  options: ReportRenderOptions,
): string {
  if (!hasDetectedServices(scan.servicePosture)) {
    return `${renderMarkdownReport(scan.validationReport, options)}\n\nTip: Organize your resources into services with 'stronghold services detect'`;
  }

  const lines: string[] = [];
  const serviceLabels = buildServiceLookup(scan);
  const findingLifecycles = options.findingLifecycles ?? new Map();
  const scenarioNameById = buildScenarioNameLookup(scan.scenarioAnalysis ?? null);
  const scenarioHeadline = renderScenarioCoverageHeadline(scan);
  const scenarioCoverageLine = scan.scenarioAnalysis
    ? renderScenarioCoverageLine(scan.scenarioAnalysis.summary)
    : null;

  lines.push('## Executive Summary');
  lines.push('');
  lines.push(
    scenarioHeadline
      ? `- ${scenarioHeadline}`
      :
      `- Global score: ${scan.validationReport.scoreBreakdown.overall}/100 (${scan.validationReport.scoreBreakdown.grade})`,
  );
  if (scenarioCoverageLine) {
    lines.push(`- ${scenarioCoverageLine}`);
  }
  lines.push(`- Services detected: ${scan.servicePosture.services.length}`);
  lines.push('');
  appendMarkdownEvidenceMaturity(lines, scan.validationReport);

  for (const service of sortServiceEntries(scan.servicePosture.services)) {
    lines.push('');
    lines.push(`## Service: ${service.service.id} (${service.score.grade} - ${service.score.score}/100)`);
    lines.push('');
    lines.push(`- Name: ${service.service.name}`);
    lines.push(`- Criticality: ${service.score.criticality}`);
    lines.push(`- Owner: ${formatDeclaredOwnerVerbose(service.score.owner)}`);
    lines.push(`- Source: ${formatDetectionSource(service.score.detectionSource)}`);
    lines.push(`- Resources: ${service.service.resources.length}`);
    lines.push(`- Findings: ${formatFindingsCount(service.score.findingsCount)}`);
    lines.push('');
    lines.push('### Contextual Findings');
    lines.push('');
    appendMarkdownContextualFindings(
      lines,
      filterContextualFindings(service.contextualFindings, options),
      scenarioNameById,
      findingLifecycles,
    );
    if (options.showResolved) {
      lines.push('');
      lines.push('### Resolved Findings');
      lines.push('');
      lines.push(
        ...renderMarkdownResolvedServiceFindings(
          service.service.id,
          service.service.name,
          scan.validationReport.results,
          options.resolvedLifecycles ?? [],
          options,
        ),
      );
    }
    lines.push('');
    lines.push('### Recommendations');
    lines.push('');
    appendMarkdownRecommendations(lines, service.recommendations);
  }

  if (scan.servicePosture.unassigned.resourceCount > 0) {
    lines.push('');
    lines.push('## Unassigned Resources');
    lines.push('');
    lines.push(`- Resource count: ${scan.servicePosture.unassigned.resourceCount}`);
    appendMarkdownContextualFindings(
      lines,
      filterContextualFindings(scan.servicePosture.unassigned.contextualFindings, options),
      scenarioNameById,
      findingLifecycles,
    );
  }

  lines.push('');
  lines.push('## Recommendations Summary');
  lines.push('');
  appendMarkdownRecommendations(lines, scan.servicePosture.recommendations);

  if (options.showPassed) {
    lines.push('');
    lines.push('## Verified Controls');
    lines.push('');
    lines.push(
      ...renderMarkdownVerifiedControls(
        filterValidationResults(scan.validationReport, options),
        serviceLabels,
      ),
    );
  }
  if (options.explainScore) {
    lines.push('');
    appendMarkdownScoreExplanation(
      lines,
      filterValidationResults(scan.validationReport, options),
      scan.validationReport,
      serviceLabels,
    );
  }

  return lines.join('\n');
}

export function buildServiceReportJson(
  scan: ScanResults,
  filters: ReportRenderOptions,
): Record<string, unknown> {
  const posture = scan.servicePosture;

  return {
    ...scan.validationReport,
    results: filterValidationResults(scan.validationReport, filters),
    global: {
      score: scan.validationReport.scoreBreakdown.overall,
      grade: scan.validationReport.scoreBreakdown.grade,
      serviceCount: posture?.services.length ?? 0,
      unassignedResources: posture?.unassigned.resourceCount ?? scan.nodes.length,
    },
    services:
      posture?.services.map((service) => ({
        ...service,
        contextualFindings: filterContextualFindings(service.contextualFindings, filters),
      })) ?? [],
    unassigned: posture
      ? {
          ...posture.unassigned,
          contextualFindings: filterContextualFindings(posture.unassigned.contextualFindings, filters),
        }
      : {
          score: null,
          resourceCount: scan.nodes.length,
          contextualFindings: [],
          recommendations: [],
        },
    recommendations: posture?.recommendations ?? [],
    scenarios: scan.scenarioAnalysis?.scenarios ?? [],
    defaultScenarioIds: scan.scenarioAnalysis?.defaultScenarioIds ?? [],
    scenarioCoverage: scan.scenarioAnalysis?.summary ?? null,
  };
}

function appendSeveritySection(
  lines: string[],
  title: string,
  results: readonly WeightedValidationResult[],
  severities: readonly ValidationSeverity[],
  findingLifecycles: ReadonlyMap<string, FindingLifecycle>,
  serviceLabels: ReadonlyMap<string, string>,
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
    const serviceLabel = serviceLabels.get(result.nodeId);
    lines.push(
      `${formatSeverityLabel(result)} ${result.ruleId} - ${result.nodeName}${serviceLabel ? ` (service: ${serviceLabel})` : ''}`,
    );
    appendLifecycleAge(lines, findingLifecycles.get(buildFindingKey(result.ruleId, result.nodeId)));
    lines.push(`DR impact: ${result.message}`);
    appendValidationEvidence(lines, result);
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
  findingLifecycles: ReadonlyMap<string, FindingLifecycle>,
  serviceLabels: ReadonlyMap<string, string>,
): void {
  lines.push('');
  lines.push(theme.section('Warnings'));
  const warnings = results.filter((result) => result.status === 'warn');
  if (warnings.length === 0) {
    lines.push('No warnings.');
    return;
  }

  warnings.forEach((result) => {
    const serviceLabel = serviceLabels.get(result.nodeId);
    lines.push(
      `${theme.warn('warning')} ${result.ruleId} - ${result.nodeName}${serviceLabel ? ` (service: ${serviceLabel})` : ''}`,
    );
    appendLifecycleAge(lines, findingLifecycles.get(buildFindingKey(result.ruleId, result.nodeId)));
    lines.push(`DR impact: ${result.message}`);
    appendValidationEvidence(lines, result);
    lines.push('');
  });
}

function renderMarkdownFindings(
  results: readonly WeightedValidationResult[],
  severities: readonly ValidationSeverity[],
  findingLifecycles: ReadonlyMap<string, FindingLifecycle>,
  serviceLabels: ReadonlyMap<string, string>,
): readonly string[] {
  const findings = results.filter(
    (result) =>
      severities.includes(result.severity) &&
      (result.status === 'fail' || result.status === 'error'),
  );
  if (findings.length === 0) {
    return ['No findings.'];
  }

  return findings.flatMap((result) => {
    const serviceLabel = serviceLabels.get(result.nodeId);
    const lifecycle = findingLifecycles.get(buildFindingKey(result.ruleId, result.nodeId));
    const lines = [
      `- **${result.ruleId}** on \`${result.nodeName}\`${serviceLabel ? ` (service: ${serviceLabel})` : ''}: ${result.message}`,
      ...renderMarkdownLifecycleAge(lifecycle),
      ...renderMarkdownValidationEvidence(result),
    ];
    if (result.remediation) {
      lines.push(`- Remediation: ${result.remediation}`);
    }
    return lines;
  });
}

function renderMarkdownWarnings(
  results: readonly WeightedValidationResult[],
  findingLifecycles: ReadonlyMap<string, FindingLifecycle>,
  serviceLabels: ReadonlyMap<string, string>,
): readonly string[] {
  const warnings = results.filter((result) => result.status === 'warn');
  if (warnings.length === 0) {
    return ['No warnings.'];
  }

  return warnings.flatMap((result) => {
    const serviceLabel = serviceLabels.get(result.nodeId);
    const lifecycle = findingLifecycles.get(buildFindingKey(result.ruleId, result.nodeId));
    return [
      `- **${result.ruleId}** on \`${result.nodeName}\`${serviceLabel ? ` (service: ${serviceLabel})` : ''}: ${result.message}`,
      ...renderMarkdownLifecycleAge(lifecycle),
      ...renderMarkdownValidationEvidence(result),
    ];
  });
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

function appendContextualFindings(
  lines: string[],
  findings: readonly ContextualFinding[],
  scenarioNameById: ReadonlyMap<string, string>,
  findingLifecycles: ReadonlyMap<string, FindingLifecycle>,
): void {
  lines.push('Contextual findings:');
  if (findings.length === 0) {
    lines.push('No findings.');
    return;
  }

  findings.forEach((finding) => {
    lines.push(`${formatFindingSeverity(finding.severity)} ${finding.ruleId} - ${finding.nodeName}`);
    appendLifecycleAge(lines, findingLifecycles.get(buildFindingKey(finding.ruleId, finding.nodeId)));
    lines.push(`DR impact: ${finding.drImpact.summary}`);
    lines.push(`Recovery implication: ${finding.drImpact.recoveryImplication}`);
    appendContextualFindingEvidence(lines, finding);
    lines.push(
      `Technical: ${finding.technicalImpact.metadataKey}=${formatMetadataValue(finding.technicalImpact.metadataValue)} (expected ${finding.technicalImpact.expectedValue})`,
    );
    if (finding.remediation?.actions[0]) {
      lines.push(
        `Remediation: ${finding.remediation.actions[0].title} [${finding.remediation.risk.toUpperCase()}]`,
      );
    }
    if (finding.scenarioImpact) {
      lines.push(
        `Scenarios: Affects ${finding.scenarioImpact.affectedScenarios.length} scenario${finding.scenarioImpact.affectedScenarios.length === 1 ? '' : 's'} (${formatScenarioList(finding.scenarioImpact.affectedScenarios, scenarioNameById)})`,
      );
      lines.push(`Worst case: ${finding.scenarioImpact.worstCaseOutcome}`);
    }
    lines.push('');
  });
}

function appendServiceRecommendations(
  lines: string[],
  recommendations: readonly ServiceRecommendationProjection[],
): void {
  lines.push('Recommendations:');
  if (recommendations.length === 0) {
    lines.push('No recommendations.');
    return;
  }

  recommendations.slice(0, 5).forEach((recommendation, index) => {
    lines.push(
      `${index + 1}. [${recommendation.risk.toUpperCase()}] ${recommendation.title} (+${recommendation.impact.scoreDelta})`,
    );
    if (recommendation.drImpactSummary) {
      lines.push(`   DR impact: ${recommendation.drImpactSummary}`);
    }
    lines.push(`   Command: ${recommendation.remediation.command}`);
  });
}

function appendMarkdownContextualFindings(
  lines: string[],
  findings: readonly ContextualFinding[],
  scenarioNameById: ReadonlyMap<string, string>,
  findingLifecycles: ReadonlyMap<string, FindingLifecycle>,
): void {
  if (findings.length === 0) {
    lines.push('No findings.');
    return;
  }

  findings.forEach((finding) => {
    const lifecycle = findingLifecycles.get(buildFindingKey(finding.ruleId, finding.nodeId));
    lines.push(`- **${finding.ruleId}** on \`${finding.nodeName}\`: ${finding.drImpact.summary}`);
    lines.push(...renderMarkdownLifecycleAge(lifecycle));
    lines.push(...renderMarkdownContextualEvidence(finding));
    lines.push(
      `- Technical: ${finding.technicalImpact.metadataKey}=${formatMetadataValue(finding.technicalImpact.metadataValue)} (expected ${finding.technicalImpact.expectedValue})`,
    );
    lines.push(`- Recovery implication: ${finding.drImpact.recoveryImplication}`);
    if (finding.remediation?.actions[0]) {
      lines.push(
        `- Remediation: ${finding.remediation.actions[0].title} [${finding.remediation.risk.toUpperCase()}]`,
      );
    }
    if (finding.scenarioImpact) {
      lines.push(
        `- Scenarios: Affects ${finding.scenarioImpact.affectedScenarios.length} scenario${finding.scenarioImpact.affectedScenarios.length === 1 ? '' : 's'} (${formatScenarioList(finding.scenarioImpact.affectedScenarios, scenarioNameById)})`,
      );
      lines.push(`- Worst case: ${finding.scenarioImpact.worstCaseOutcome}`);
    }
    lines.push('');
  });
}

function appendMarkdownRecommendations(
  lines: string[],
  recommendations: readonly ServiceRecommendationProjection[],
): void {
  if (recommendations.length === 0) {
    lines.push('No recommendations.');
    return;
  }

  recommendations.slice(0, 8).forEach((recommendation) => {
    lines.push(
      `- **[${recommendation.risk.toUpperCase()}] ${recommendation.title}** (+${recommendation.impact.scoreDelta})`,
    );
    if (recommendation.drImpactSummary) {
      lines.push(`- DR impact: ${recommendation.drImpactSummary}`);
    }
    lines.push(`- Command: \`${recommendation.remediation.command}\``);
    lines.push('');
  });
}

function filterResolvedLifecycles(
  resolvedLifecycles: readonly FindingLifecycle[],
  options: ReportRenderOptions,
  results: readonly WeightedValidationResult[],
): readonly FindingLifecycle[] {
  return resolvedLifecycles
    .filter((lifecycle) => lifecycle.status === 'resolved')
    .filter((lifecycle) => {
      if (!options.severity || !lifecycle.severity) {
        return true;
      }
      return SEVERITY_RANK[lifecycle.severity] >= SEVERITY_RANK[options.severity as ValidationSeverity];
    })
    .filter((lifecycle) => {
      if (!options.category) {
        return true;
      }
      const result = results.find(
        (entry) => entry.ruleId === lifecycle.ruleId && entry.nodeId === lifecycle.nodeId,
      );
      return result?.category === options.category;
    })
    .sort(
      (left, right) =>
        (right.resolvedAt ?? right.lastSeenAt).localeCompare(left.resolvedAt ?? left.lastSeenAt) ||
        left.ruleId.localeCompare(right.ruleId) ||
        left.nodeId.localeCompare(right.nodeId),
    );
}

function resolveLifecycleResolution(
  lifecycle: FindingLifecycle,
  results: readonly WeightedValidationResult[],
): string {
  const currentResult = results.find(
    (entry) =>
      entry.ruleId === lifecycle.ruleId &&
      entry.nodeId === lifecycle.nodeId &&
      entry.status === 'pass',
  );
  return currentResult?.message ?? 'No longer detected in the latest scan.';
}

function shortLifecycleNodeLabel(lifecycle: FindingLifecycle): string {
  return lifecycle.nodeId.split('/').at(-1) ?? lifecycle.nodeId.split(':').at(-1) ?? lifecycle.nodeId;
}

function appendResolvedFindingsSection(
  lines: string[],
  results: readonly WeightedValidationResult[],
  resolvedLifecycles: readonly FindingLifecycle[],
  options: ReportRenderOptions,
  serviceLabels: ReadonlyMap<string, string>,
): void {
  const resolved = filterResolvedLifecycles(resolvedLifecycles, options, results);
  lines.push('');
  lines.push(theme.section('Resolved Findings'));
  if (resolved.length === 0) {
    lines.push('No resolved findings in the current filter.');
    return;
  }

  resolved.forEach((lifecycle) => {
    const serviceLabel = serviceLabels.get(lifecycle.nodeId);
    lines.push(
      `RESOLVED ${lifecycle.ruleId} - ${shortLifecycleNodeLabel(lifecycle)}${serviceLabel ? ` (service: ${serviceLabel})` : ''}`,
    );
    lines.push(
      `Was active for ${lifecycle.ageInDays} day${lifecycle.ageInDays === 1 ? '' : 's'} (${lifecycle.firstSeenAt.slice(0, 10)} -> ${(lifecycle.resolvedAt ?? lifecycle.lastSeenAt).slice(0, 10)})`,
    );
    lines.push(`Resolution: ${resolveLifecycleResolution(lifecycle, results)}`);
    lines.push('');
  });
}

function renderMarkdownResolvedFindings(
  results: readonly WeightedValidationResult[],
  resolvedLifecycles: readonly FindingLifecycle[],
  options: ReportRenderOptions,
  serviceLabels: ReadonlyMap<string, string>,
): readonly string[] {
  const resolved = filterResolvedLifecycles(resolvedLifecycles, options, results);
  if (resolved.length === 0) {
    return ['No resolved findings in the current filter.'];
  }

  return resolved.flatMap((lifecycle) => {
    const serviceLabel = serviceLabels.get(lifecycle.nodeId);
    return [
      `- **${lifecycle.ruleId}** on \`${shortLifecycleNodeLabel(lifecycle)}\`${serviceLabel ? ` (service: ${serviceLabel})` : ''}`,
      `- Was active for ${lifecycle.ageInDays} day${lifecycle.ageInDays === 1 ? '' : 's'} (${lifecycle.firstSeenAt.slice(0, 10)} -> ${(lifecycle.resolvedAt ?? lifecycle.lastSeenAt).slice(0, 10)})`,
      `- Resolution: ${resolveLifecycleResolution(lifecycle, results)}`,
      '',
    ];
  });
}

function appendResolvedServiceFindings(
  lines: string[],
  serviceId: string,
  _serviceName: string,
  results: readonly WeightedValidationResult[],
  resolvedLifecycles: readonly FindingLifecycle[],
  options: ReportRenderOptions,
): void {
  const resolved = filterResolvedLifecycles(resolvedLifecycles, options, results).filter(
    (lifecycle) => lifecycle.serviceId === serviceId,
  );
  lines.push('Resolved findings:');
  if (resolved.length === 0) {
    lines.push('No resolved findings.');
    return;
  }

  resolved.forEach((lifecycle) => {
    lines.push(`RESOLVED ${lifecycle.ruleId} - ${shortLifecycleNodeLabel(lifecycle)}`);
    lines.push(
      `Was active for ${lifecycle.ageInDays} day${lifecycle.ageInDays === 1 ? '' : 's'} (${lifecycle.firstSeenAt.slice(0, 10)} -> ${(lifecycle.resolvedAt ?? lifecycle.lastSeenAt).slice(0, 10)})`,
    );
    lines.push(`Resolution: ${resolveLifecycleResolution(lifecycle, results)}`);
    lines.push('');
  });
}

function renderMarkdownResolvedServiceFindings(
  serviceId: string,
  _serviceName: string,
  results: readonly WeightedValidationResult[],
  resolvedLifecycles: readonly FindingLifecycle[],
  options: ReportRenderOptions,
): readonly string[] {
  const resolved = filterResolvedLifecycles(resolvedLifecycles, options, results).filter(
    (lifecycle) => lifecycle.serviceId === serviceId,
  );
  if (resolved.length === 0) {
    return ['No resolved findings.'];
  }

  return resolved.flatMap((lifecycle) => [
    `- **${lifecycle.ruleId}** on \`${shortLifecycleNodeLabel(lifecycle)}\``,
    `- Was active for ${lifecycle.ageInDays} day${lifecycle.ageInDays === 1 ? '' : 's'} (${lifecycle.firstSeenAt.slice(0, 10)} -> ${(lifecycle.resolvedAt ?? lifecycle.lastSeenAt).slice(0, 10)})`,
    `- Resolution: ${resolveLifecycleResolution(lifecycle, results)}`,
    '',
  ]);
}

function appendEvidenceMaturitySection(lines: string[], report: ValidationReport): void {
  const summary = getEvidenceSummary(report);
  lines.push('');
  lines.push(theme.section('Evidence Maturity'));
  lines.push(`Tested: ${summary.counts.tested}/${summary.total} rules`);
  lines.push(`Observed: ${summary.counts.observed}/${summary.total} rules`);
  lines.push(`Inferred: ${summary.counts.inferred}/${summary.total} rules`);
  lines.push(`Declared: ${summary.counts.declared}/${summary.total} rules`);
  lines.push(`Expired: ${summary.counts.expired}/${summary.total} rules`);
  lines.push(
    `Potential score if all rules were test-verified: ${summary.potentialScore}/100 (current: ${report.scoreBreakdown.overall}/100)`,
  );
}

function appendMarkdownEvidenceMaturity(lines: string[], report: ValidationReport): void {
  const summary = getEvidenceSummary(report);
  lines.push('## Evidence Maturity');
  lines.push('');
  lines.push(`- Tested: ${summary.counts.tested}/${summary.total} rules`);
  lines.push(`- Observed: ${summary.counts.observed}/${summary.total} rules`);
  lines.push(`- Inferred: ${summary.counts.inferred}/${summary.total} rules`);
  lines.push(`- Declared: ${summary.counts.declared}/${summary.total} rules`);
  lines.push(`- Expired: ${summary.counts.expired}/${summary.total} rules`);
  lines.push(
    `- Potential score if all rules were test-verified: ${summary.potentialScore}/100 (current: ${report.scoreBreakdown.overall}/100)`,
  );
}

function appendVerifiedControlsSection(
  lines: string[],
  results: readonly WeightedValidationResult[],
  serviceLabels: ReadonlyMap<string, string>,
): void {
  const passed = results.filter((result) => result.status === 'pass');
  lines.push('');
  lines.push(theme.section('Verified Controls'));
  if (passed.length === 0) {
    lines.push('No verified controls in the current filter.');
    return;
  }

  passed.forEach((result) => {
    const serviceLabel = serviceLabels.get(result.nodeId);
    const evidenceInfo = resolveResultEvidence(result);
    lines.push(
      `PASS ${result.ruleId} - ${result.nodeName}${serviceLabel ? ` (service: ${serviceLabel})` : ''}`,
    );
    appendValidationEvidence(lines, result);
    lines.push(`Score credit: ${evidenceInfo.type} (${evidenceInfo.confidence.toFixed(2)})`);
    lines.push('');
  });
}

function renderMarkdownVerifiedControls(
  results: readonly WeightedValidationResult[],
  serviceLabels: ReadonlyMap<string, string> = new Map(),
): readonly string[] {
  const passed = results.filter((result) => result.status === 'pass');
  if (passed.length === 0) {
    return ['No verified controls in the current filter.'];
  }

  return passed.flatMap((result) => {
    const serviceLabel = serviceLabels.get(result.nodeId);
    const evidenceInfo = resolveResultEvidence(result);
    return [
      `- **${result.ruleId}** on \`${result.nodeName}\`${serviceLabel ? ` (service: ${serviceLabel})` : ''}`,
      ...renderMarkdownValidationEvidence(result),
      `- Score credit: ${evidenceInfo.type} (${evidenceInfo.confidence.toFixed(2)})`,
      '',
    ];
  });
}

function appendScoreExplanationSection(
  lines: string[],
  results: readonly WeightedValidationResult[],
  report: ValidationReport,
  serviceLabels: ReadonlyMap<string, string>,
): void {
  const scored = results.filter((result) => result.status !== 'skip');
  const summary = getEvidenceSummary(report);

  lines.push('');
  lines.push(
    theme.section(
      `Score Decomposition - Global: ${report.scoreBreakdown.overall}/100 (${report.scoreBreakdown.grade})`,
    ),
  );
  if (scored.length === 0) {
    lines.push('No scored rules in the current filter.');
    return;
  }

  lines.push(
    `${pad('Rule', 24)} ${pad('Node', 18)} ${pad('Weight', 8)} ${pad('Result', 7)} ${pad('Evidence', 16)} Contribution`,
  );
  lines.push('-'.repeat(88));
  scored.forEach((result) => {
    const evidenceInfo = resolveResultEvidence(result);
    const evidenceLabel = `${evidenceInfo.type}(${evidenceInfo.confidence.toFixed(2)})`;
    const serviceLabel = serviceLabels.get(result.nodeId);
    const nodeLabel = serviceLabel ? `${result.nodeName}/${serviceLabel}` : result.nodeName;
    lines.push(
      `${pad(result.ruleId, 24)} ${pad(nodeLabel, 18)} ${pad(result.weight.toFixed(1), 8)} ${pad(result.status.toUpperCase(), 7)} ${pad(evidenceLabel, 16)} ${formatSignedContribution(result)}`,
    );
  });
  const potentialGain = Math.max(0, summary.potentialScore - report.scoreBreakdown.overall);
  lines.push('');
  lines.push('Evidence maturity distribution:');
  lines.push(`  Tested: ${summary.counts.tested}/${summary.total} rules`);
  lines.push(`  Observed: ${summary.counts.observed}/${summary.total} rules`);
  lines.push(`  Inferred: ${summary.counts.inferred}/${summary.total} rules`);
  lines.push(`  Declared: ${summary.counts.declared}/${summary.total} rules`);
  lines.push(`  Expired: ${summary.counts.expired}/${summary.total} rules`);
  lines.push(`  Potential gain if all passing rules were tested: +${potentialGain} points`);
}

function appendMarkdownScoreExplanation(
  lines: string[],
  results: readonly WeightedValidationResult[],
  report: ValidationReport,
  serviceLabels: ReadonlyMap<string, string>,
): void {
  const scored = results.filter((result) => result.status !== 'skip');
  const summary = getEvidenceSummary(report);

  lines.push(`## Score Decomposition - ${report.scoreBreakdown.overall}/100 (${report.scoreBreakdown.grade})`);
  lines.push('');
  if (scored.length === 0) {
    lines.push('No scored rules in the current filter.');
    return;
  }

  lines.push('| Rule | Node | Weight | Result | Evidence | Contribution |');
  lines.push('| --- | --- | ---: | --- | --- | ---: |');
  scored.forEach((result) => {
    const evidenceInfo = resolveResultEvidence(result);
    const serviceLabel = serviceLabels.get(result.nodeId);
    const nodeLabel = serviceLabel ? `${result.nodeName}/${serviceLabel}` : result.nodeName;
    lines.push(
      `| ${result.ruleId} | ${nodeLabel} | ${result.weight.toFixed(1)} | ${result.status.toUpperCase()} | ${evidenceInfo.type} (${evidenceInfo.confidence.toFixed(2)}) | ${formatSignedContribution(result)} |`,
    );
  });
  const potentialGain = Math.max(0, summary.potentialScore - report.scoreBreakdown.overall);
  lines.push('');
  lines.push('### Evidence maturity distribution');
  lines.push('');
  lines.push(`- Tested: ${summary.counts.tested}/${summary.total} rules`);
  lines.push(`- Observed: ${summary.counts.observed}/${summary.total} rules`);
  lines.push(`- Inferred: ${summary.counts.inferred}/${summary.total} rules`);
  lines.push(`- Declared: ${summary.counts.declared}/${summary.total} rules`);
  lines.push(`- Expired: ${summary.counts.expired}/${summary.total} rules`);
  lines.push(`- Potential gain if all passing rules were tested: +${potentialGain} points`);
}

function appendValidationEvidence(lines: string[], result: WeightedValidationResult): void {
  renderValidationEvidence(result).forEach((line) => lines.push(line));
}

function appendContextualFindingEvidence(lines: string[], finding: ContextualFinding): void {
  renderContextualEvidence(finding).forEach((line) => lines.push(line));
}

function appendLifecycleAge(lines: string[], lifecycle: FindingLifecycle | undefined): void {
  if (!lifecycle) {
    return;
  }
  lines.push(
    `Age: ${lifecycle.ageInDays} day${lifecycle.ageInDays === 1 ? '' : 's'} (first seen: ${lifecycle.firstSeenAt.slice(0, 10)})`,
  );
}

function renderMarkdownLifecycleAge(
  lifecycle: FindingLifecycle | undefined,
): readonly string[] {
  if (!lifecycle) {
    return [];
  }
  return [
    `- Age: ${lifecycle.ageInDays} day${lifecycle.ageInDays === 1 ? '' : 's'} (first seen: ${lifecycle.firstSeenAt.slice(0, 10)})`,
  ];
}

function renderMarkdownValidationEvidence(
  result: WeightedValidationResult,
): readonly string[] {
  return renderValidationEvidence(result).map((line) => `- ${line}`);
}

function renderMarkdownContextualEvidence(
  finding: ContextualFinding,
): readonly string[] {
  return renderContextualEvidence(finding).map((line) => `- ${line}`);
}

function renderValidationEvidence(result: WeightedValidationResult): readonly string[] {
  return renderEvidenceLines(extractResultEvidence(result));
}

function renderContextualEvidence(finding: ContextualFinding): readonly string[] {
  return renderEvidenceLines(finding.evidence ?? []);
}

function renderEvidenceLines(evidence: readonly Evidence[]): readonly string[] {
  if (evidence.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let expectedShown = false;
  evidence.forEach((entry) => {
    const label = isTestEvidence(entry) ? 'Test evidence' : 'Evidence';
    lines.push(`${label}: ${formatEvidenceEntry(entry)}`);
    if (!expectedShown && entry.observation.expected) {
      lines.push(`Expected: ${entry.observation.expected}`);
      expectedShown = true;
    }
  });
  return lines;
}

function formatEvidenceEntry(entry: Evidence): string {
  if (isTestEvidence(entry)) {
    const status =
      entry.testResult?.status?.toUpperCase() ?? String(entry.observation.value).toUpperCase();
    const duration = entry.testResult?.duration ? ` (${entry.testResult.duration})` : '';
    const executor = entry.testResult?.executor
      ? `, self-declared by ${entry.testResult.executor}`
      : ', self-declared';
    const freshness = formatEvidenceFreshness(entry);
    const testLabel = entry.source.origin === 'test' ? entry.source.testType : entry.observation.key;
    return `${testLabel} ${status} on ${entry.timestamp.slice(0, 10)}${duration}${executor}${freshness ? ` - ${freshness}` : ''}`;
  }

  return `${entry.observation.key} = ${formatMetadataValue(entry.observation.value ?? null)} (${entry.type} ${entry.timestamp})`;
}

function formatScenarioList(
  scenarioIds: readonly string[],
  scenarioNameById: ReadonlyMap<string, string>,
): string {
  return scenarioIds
    .map((scenarioId) => scenarioNameById.get(scenarioId) ?? scenarioId)
    .join(', ');
}

function formatEvidenceFreshness(entry: Evidence): string {
  if (!entry.expiresAt) {
    return '';
  }

  const freshness = checkFreshness(entry, new Date());
  if (freshness.status === 'expired') {
    return `EXPIRED (${entry.expiresAt.slice(0, 10)})`;
  }
  if (freshness.daysUntilExpiry === null) {
    return '';
  }
  return `expires in ${freshness.daysUntilExpiry} day${freshness.daysUntilExpiry === 1 ? '' : 's'}`;
}

function resolveResultEvidence(
  result: WeightedValidationResult,
): { readonly type: EvidenceType; readonly confidence: number } {
  const breakdown = result.weightBreakdown as WeightedValidationResult['weightBreakdown'] & {
    readonly evidenceType?: EvidenceType;
    readonly evidenceConfidence?: number;
  };
  if (breakdown.evidenceType && typeof breakdown.evidenceConfidence === 'number') {
    return {
      type: breakdown.evidenceType,
      confidence: breakdown.evidenceConfidence,
    };
  }

  const evidence = extractResultEvidence(result);
  if (evidence.length === 0) {
    return {
      type: 'observed',
      confidence: EVIDENCE_CONFIDENCE.observed,
    };
  }

  const firstEvidence = evidence[0];
  if (!firstEvidence) {
    return {
      type: 'observed',
      confidence: EVIDENCE_CONFIDENCE.observed,
    };
  }

  return evidence.reduce(
    (strongest, entry) =>
      EVIDENCE_CONFIDENCE[entry.type] > strongest.confidence
        ? {
            type: entry.type,
            confidence: EVIDENCE_CONFIDENCE[entry.type],
          }
        : strongest,
    {
      type: firstEvidence.type,
      confidence: EVIDENCE_CONFIDENCE[firstEvidence.type],
    },
  );
}

function extractResultEvidence(result: WeightedValidationResult): readonly Evidence[] {
  return 'evidence' in result && Array.isArray(result.evidence) ? result.evidence : [];
}

function getEvidenceSummary(report: ValidationReport): EvidenceMaturitySummary {
  return hasEvidenceSummary(report)
    ? report.evidenceSummary
    : summarizeEvidenceMaturity(report.results);
}

function hasEvidenceSummary(report: ValidationReport): report is ValidationReportWithEvidence {
  return 'evidenceSummary' in report;
}

function buildServiceLookup(scan: ScanResults): ReadonlyMap<string, string> {
  const entries =
    scan.servicePosture?.services.flatMap((service) =>
      service.service.resources.map((resource) => [resource.nodeId, service.service.id] as const),
    ) ?? [];
  return new Map(entries);
}

function isTestEvidence(entry: Evidence): boolean {
  return entry.source.origin === 'test' || entry.type === 'tested' || entry.type === 'expired';
}

function formatSignedContribution(result: WeightedValidationResult): string {
  if (result.status === 'pass') {
    return `+${(result.weight * resolveResultEvidence(result).confidence).toFixed(1)}`;
  }
  if (result.status === 'warn') {
    return `+${(result.weight * 0.5).toFixed(1)}`;
  }
  if (result.status === 'fail' || result.status === 'error') {
    return `-${result.weight.toFixed(1)}`;
  }
  return '0.0';
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width);
}
