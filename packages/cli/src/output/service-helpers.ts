import type {
  ContextualFinding,
  Criticality,
  DetectionSource,
  ServicePosture,
  ServicePostureService,
  ServiceRecommendationProjection,
  ServiceScore,
  ValidationSeverity,
} from '@stronghold-dr/core';

const CRITICALITY_RANK: Readonly<Record<Criticality, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const SEVERITY_RANK: Readonly<Record<ValidationSeverity, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function hasDetectedServices(
  posture: ServicePosture | undefined,
): posture is ServicePosture {
  return Boolean(posture && posture.services.length > 0);
}

export function sortServiceEntries(
  services: readonly ServicePostureService[],
): readonly ServicePostureService[] {
  return [...services].sort(
    (left, right) =>
      CRITICALITY_RANK[left.score.criticality] - CRITICALITY_RANK[right.score.criticality] ||
      left.score.score - right.score.score ||
      left.service.name.localeCompare(right.service.name),
  );
}

export function sortServiceScores(
  services: readonly ServiceScore[],
): readonly ServiceScore[] {
  return [...services].sort(
    (left, right) =>
      CRITICALITY_RANK[left.criticality] - CRITICALITY_RANK[right.criticality] ||
      left.score - right.score ||
      left.serviceName.localeCompare(right.serviceName),
  );
}

export function formatDeclaredOwner(owner: string | undefined): string {
  return owner ? `${owner} (declared)` : 'Not declared';
}

export function formatDeclaredOwnerVerbose(owner: string | undefined): string {
  return owner ? `${owner} (declared, not verified)` : 'Not declared';
}

export function formatDetectionSource(source: DetectionSource): string {
  if (source.type === 'manual') {
    return `manual (${source.file})`;
  }
  if (source.type === 'cloudformation') {
    return `cloudformation (${source.stackName})`;
  }
  if (source.type === 'tag') {
    return `tag (${source.key}=${source.value})`;
  }
  return `topology (${source.confidence.toFixed(2)})`;
}

export function formatSourceBadge(source: DetectionSource): string {
  if (source.type === 'manual') return 'manual';
  if (source.type === 'cloudformation') return 'cloudformation';
  if (source.type === 'tag') return 'tag';
  return `topology (${source.confidence.toFixed(2)})`;
}

export function formatFindingsCount(
  counts: ServiceScore['findingsCount'],
): string {
  if (counts.critical > 0) {
    return `${counts.critical} critical finding${counts.critical === 1 ? '' : 's'}`;
  }
  if (counts.high > 0) {
    return `${counts.high} high finding${counts.high === 1 ? '' : 's'}`;
  }
  if (counts.medium > 0) {
    return `${counts.medium} medium finding${counts.medium === 1 ? '' : 's'}`;
  }
  if (counts.low > 0) {
    return `${counts.low} low finding${counts.low === 1 ? '' : 's'}`;
  }
  return '0 critical findings';
}

export function filterContextualFindings(
  findings: readonly ContextualFinding[],
  filters: {
    readonly category?: string;
    readonly severity?: string;
  },
): readonly ContextualFinding[] {
  return findings
    .filter((finding) => (filters.category ? finding.category === filters.category : true))
    .filter((finding) =>
      filters.severity
        ? SEVERITY_RANK[finding.severity] >=
          SEVERITY_RANK[filters.severity as ValidationSeverity]
        : true,
    )
    .sort(compareContextualFindings);
}

export function formatFindingSeverity(severity: ValidationSeverity): string {
  return severity.toUpperCase();
}

export function formatMetadataValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'unknown';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function selectTopServiceRecommendations(
  recommendations: readonly ServiceRecommendationProjection[],
  limit = 3,
): readonly ServiceRecommendationProjection[] {
  return recommendations.filter((item) => item.risk !== 'dangerous').slice(0, limit);
}

function compareContextualFindings(left: ContextualFinding, right: ContextualFinding): number {
  return (
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
    left.nodeName.localeCompare(right.nodeName) ||
    left.ruleId.localeCompare(right.ruleId)
  );
}
