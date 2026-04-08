import {
  calculateWeightedScore,
  gradeForScore,
  type InfraNode,
  type ValidationReport,
  type WeightedValidationResult,
} from '../validation/index.js';
import {
  buildServiceIndex,
  classifyResourceRole,
} from './service-utils.js';
import type {
  ResourceRole,
  Service,
  ServiceFinding,
  ServiceScore,
  ServiceScoringResult,
} from './service-types.js';

const NEGATIVE_STATUSES = new Set(['fail', 'warn', 'error']);

const COVERAGE_GAPS: Readonly<Record<string, string>> = {
  backup: 'Backup coverage is incomplete for this service.',
  redundancy: 'Redundant capacity is incomplete for this service.',
  failover: 'Failover paths are incomplete for this service.',
  detection: 'Failure detection coverage is incomplete for this service.',
  recovery: 'Recovery workflows are incomplete for this service.',
  replication: 'Replication coverage is incomplete for this service.',
};

export function scoreServices(
  services: readonly Service[],
  validationReport: ValidationReport,
  nodes: readonly InfraNode[],
): ServiceScoringResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const serviceScores = services.map((service) =>
    scoreSingleService(service, validationReport.results, nodeById),
  );
  const assignedNodes = buildServiceIndex(services);
  const unassignedNodeIds = nodes
    .map((node) => node.id)
    .filter((nodeId) => !assignedNodes.has(nodeId));

  return {
    services: serviceScores,
    unassigned:
      unassignedNodeIds.length > 0
        ? scoreSingleService(
            {
              id: '__unassigned__',
              name: 'Unassigned',
              criticality: 'medium',
              detectionSource: {
                type: 'topology',
                algorithm: 'unassigned',
                confidence: 0,
              },
              resources: unassignedNodeIds.map((nodeId) => ({
                nodeId,
                role: classifyResourceRole(nodeById.get(nodeId)!),
                detectionSource: {
                  type: 'topology',
                  algorithm: 'unassigned',
                  confidence: 0,
                },
              })),
              metadata: {},
            },
            validationReport.results,
            nodeById,
          )
        : null,
  };
}

function scoreSingleService(
  service: Service,
  validationResults: readonly WeightedValidationResult[],
  nodeById: ReadonlyMap<string, InfraNode>,
): ServiceScore {
  const roleByNodeId = new Map(
    service.resources.map((resource) => [
      resource.nodeId,
      resource.role ?? classifyResourceRole(nodeById.get(resource.nodeId)!),
    ] as const),
  );
  const relevantResults = validationResults.filter((result) => roleByNodeId.has(result.nodeId));
  const unresolvedResults = relevantResults.filter((result) => NEGATIVE_STATUSES.has(result.status));
  const findings = unresolvedResults
    .map((result) => ({
      ...result,
      serviceId: service.id,
      serviceName: service.name,
      resourceRole: roleByNodeId.get(result.nodeId) ?? 'other',
    }))
    .sort(compareFindingsByImpact);

  const weightedResults = relevantResults
    .filter((result) => result.status !== 'skip')
    .map((result) => ({
      ...result,
      weight: result.weight * roleWeight(roleByNodeId.get(result.nodeId) ?? 'other'),
    }));
  const formulaScore = weightedResults.length === 0 ? 100 : calculateWeightedScore(weightedResults);
  const ceiling = determineScoreCeiling(unresolvedResults);
  const score = Math.min(ceiling, formulaScore);

  return {
    serviceId: service.id,
    serviceName: service.name,
    resourceCount: service.resources.length,
    criticality: service.criticality,
    ...(service.owner ? { owner: service.owner } : {}),
    detectionSource: service.detectionSource,
    score,
    grade: gradeForScore(score),
    findingsCount: countFindings(findings),
    findings,
    coverageGaps: collectCoverageGaps(findings),
  };
}

function determineScoreCeiling(results: readonly WeightedValidationResult[]): number {
  if (results.some((result) => result.severity === 'critical')) {
    return 40;
  }
  if (results.some((result) => result.severity === 'high')) {
    return 60;
  }
  return 100;
}

function countFindings(findings: readonly ServiceFinding[]): ServiceScore['findingsCount'] {
  return {
    critical: findings.filter((finding) => finding.severity === 'critical').length,
    high: findings.filter((finding) => finding.severity === 'high').length,
    medium: findings.filter((finding) => finding.severity === 'medium').length,
    low: findings.filter((finding) => finding.severity === 'low').length,
  };
}

function collectCoverageGaps(findings: readonly ServiceFinding[]): readonly string[] {
  return Array.from(
    new Set(
      findings
        .map((finding) => COVERAGE_GAPS[finding.category])
        .filter((value): value is string => typeof value === 'string'),
    ),
  );
}

function roleWeight(role: ResourceRole): number {
  if (role === 'datastore') return 2;
  if (role === 'compute') return 1.5;
  return 1;
}

function compareFindingsByImpact(left: ServiceFinding, right: ServiceFinding): number {
  const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
  return (
    severityRank[right.severity] - severityRank[left.severity] ||
    right.weight - left.weight ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.nodeId.localeCompare(right.nodeId)
  );
}
