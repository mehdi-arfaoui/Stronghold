import { gradeForScore, type InfraNode, type ValidationEdge, type ValidationReport } from '../validation/index.js';
import type { Recommendation } from '../recommendations/recommendation-types.js';
import { detectServices } from './service-detector.js';
import { contextualizeFindings } from './finding-contextualizer.js';
import { mergeServices } from './services-merger.js';
import { scoreServices } from './service-scoring.js';
import { buildServiceIndex } from './service-utils.js';
import type { ContextualFinding } from './finding-types.js';
import type { Service } from './service-types.js';
import type {
  ServicePosture,
  ServiceRecommendationProjection,
} from './service-posture-types.js';

const ACTIONABLE_STATUSES = new Set(['fail', 'warn', 'error']);

export interface BuildServicePostureInput {
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<ValidationEdge>;
  readonly validationReport: ValidationReport;
  readonly recommendations?: readonly Recommendation[];
  readonly manualServices?: readonly Service[];
  readonly onLog?: (message: string) => void;
}

export function buildServicePosture(input: BuildServicePostureInput): ServicePosture {
  const autoDetected = detectServices(input.nodes, input.edges, {
    onLog: input.onLog,
  });
  const detection =
    input.manualServices && input.manualServices.length > 0
      ? mergeServices(autoDetected, input.manualServices)
      : autoDetected;
  const scoring = scoreServices(detection.services, input.validationReport, input.nodes);
  const findings = input.validationReport.results.filter((result) =>
    ACTIONABLE_STATUSES.has(result.status),
  );
  const contextualFindings = contextualizeFindings(
    findings,
    input.nodes,
    detection.services,
    input.recommendations ?? [],
  );
  const serviceIndex = buildServiceIndex(detection.services);
  const scoreByServiceId = new Map(
    scoring.services.map((serviceScore) => [serviceScore.serviceId, serviceScore] as const),
  );
  const recommendations = (input.recommendations ?? []).map((recommendation) =>
    projectRecommendation(recommendation, serviceIndex, scoreByServiceId, contextualFindings),
  );

  return {
    detection,
    scoring,
    contextualFindings,
    recommendations,
    services: detection.services.map((service) => ({
      service,
      score: scoreByServiceId.get(service.id) ?? buildFallbackScore(service),
      contextualFindings: contextualFindings.filter((finding) => finding.serviceId === service.id),
      recommendations: recommendations.filter(
        (recommendation) => recommendation.serviceId === service.id,
      ),
    })),
    unassigned: {
      score: scoring.unassigned,
      resourceCount: detection.unassignedResources.length,
      contextualFindings: contextualFindings.filter((finding) => finding.serviceId === null),
      recommendations: recommendations.filter((recommendation) => recommendation.serviceId === null),
    },
  };
}

function projectRecommendation(
  recommendation: Recommendation,
  serviceIndex: ReadonlyMap<string, Service>,
  scoreByServiceId: ReadonlyMap<string, ServicePosture['scoring']['services'][number]>,
  contextualFindings: readonly ContextualFinding[],
): ServiceRecommendationProjection {
  const service = serviceIndex.get(recommendation.targetNode) ?? null;
  const serviceScore = service ? scoreByServiceId.get(service.id) ?? null : null;
  const currentScore = serviceScore?.score ?? null;
  const nextScore =
    currentScore === null
      ? null
      : Math.min(100, currentScore + recommendation.impact.scoreDelta);
  const relatedFinding =
    contextualFindings.find(
      (finding) =>
        finding.nodeId === recommendation.targetNode &&
        recommendation.impact.affectedRules.includes(finding.ruleId),
    ) ?? null;

  return {
    ...recommendation,
    serviceId: service?.id ?? null,
    serviceName: service?.name ?? null,
    serviceCriticality: service?.criticality ?? null,
    ...(service?.owner ? { serviceOwner: service.owner } : {}),
    projectedScore: {
      current: currentScore,
      next: nextScore,
      currentGrade: currentScore === null ? null : gradeForScore(currentScore),
      nextGrade: nextScore === null ? null : gradeForScore(nextScore),
    },
    drImpactSummary: relatedFinding?.drImpact.summary ?? null,
  };
}

function buildFallbackScore(service: Service): ServicePosture['scoring']['services'][number] {
  return {
    serviceId: service.id,
    serviceName: service.name,
    resourceCount: service.resources.length,
    criticality: service.criticality,
    ...(service.owner ? { owner: service.owner } : {}),
    detectionSource: service.detectionSource,
    score: 100,
    grade: 'A',
    findingsCount: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    findings: [],
    coverageGaps: [],
  };
}
