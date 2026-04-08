import {
  type ContextualFinding,
  formatValidationReport,
  type ServiceRecommendationProjection,
  type DRCategory,
  type ValidationReport,
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

export function renderTerminalServiceReport(
  scan: ScanResults,
  filters: ValidationFilters,
): string {
  if (!hasDetectedServices(scan.servicePosture)) {
    return `${renderTerminalReport(scan.validationReport, filters)}\n\nTip: Organize your resources into services with 'stronghold services detect'`;
  }

  const lines: string[] = [];
  lines.push(theme.section('Executive Summary'));
  lines.push(`Global score: ${formatGrade(scan.validationReport)}`);
  lines.push(`Services detected: ${scan.servicePosture.services.length}`);
  lines.push(
    `Critical services: ${scan.servicePosture.services.filter((service) => service.score.criticality === 'critical').length}`,
  );

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
      filterContextualFindings(service.contextualFindings, filters),
    );
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
      filterContextualFindings(scan.servicePosture.unassigned.contextualFindings, filters),
    );
    appendServiceRecommendations(lines, scan.servicePosture.unassigned.recommendations);
  }

  lines.push('');
  lines.push(theme.section('Recommendations Summary'));
  appendServiceRecommendations(lines, scan.servicePosture.recommendations);

  return lines.join('\n');
}

export function renderMarkdownServiceReport(
  scan: ScanResults,
  filters: ValidationFilters,
): string {
  if (!hasDetectedServices(scan.servicePosture)) {
    return `${renderMarkdownReport(scan.validationReport, filters)}\n\nTip: Organize your resources into services with 'stronghold services detect'`;
  }

  const lines: string[] = [];
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`- Global score: ${scan.validationReport.scoreBreakdown.overall}/100`);
  lines.push(`- Grade: ${scan.validationReport.scoreBreakdown.grade}`);
  lines.push(`- Services detected: ${scan.servicePosture.services.length}`);

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
      filterContextualFindings(service.contextualFindings, filters),
    );
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
      filterContextualFindings(scan.servicePosture.unassigned.contextualFindings, filters),
    );
  }

  lines.push('');
  lines.push('## Recommendations Summary');
  lines.push('');
  appendMarkdownRecommendations(lines, scan.servicePosture.recommendations);

  return lines.join('\n');
}

export function buildServiceReportJson(
  scan: ScanResults,
  filters: ValidationFilters,
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
  };
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

function appendContextualFindings(
  lines: string[],
  findings: readonly ContextualFinding[],
): void {
  lines.push('Contextual findings:');
  if (findings.length === 0) {
    lines.push('No findings.');
    return;
  }

  findings.forEach((finding) => {
    lines.push(`${formatFindingSeverity(finding.severity)} ${finding.ruleId} - ${finding.nodeName}`);
    lines.push(`DR impact: ${finding.drImpact.summary}`);
    lines.push(`Recovery implication: ${finding.drImpact.recoveryImplication}`);
    lines.push(
      `Technical: ${finding.technicalImpact.metadataKey}=${formatMetadataValue(finding.technicalImpact.metadataValue)} (expected ${finding.technicalImpact.expectedValue})`,
    );
    if (finding.remediation?.actions[0]) {
      lines.push(
        `Remediation: ${finding.remediation.actions[0].title} [${finding.remediation.risk.toUpperCase()}]`,
      );
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
): void {
  if (findings.length === 0) {
    lines.push('No findings.');
    return;
  }

  findings.forEach((finding) => {
    lines.push(
      `- **${finding.ruleId}** on \`${finding.nodeName}\`: ${finding.drImpact.summary}`,
    );
    lines.push(
      `- Technical: ${finding.technicalImpact.metadataKey}=${formatMetadataValue(finding.technicalImpact.metadataValue)} (expected ${finding.technicalImpact.expectedValue})`,
    );
    lines.push(`- Recovery implication: ${finding.drImpact.recoveryImplication}`);
    if (finding.remediation?.actions[0]) {
      lines.push(
        `- Remediation: ${finding.remediation.actions[0].title} [${finding.remediation.risk.toUpperCase()}]`,
      );
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
