import type { FindingLifecycle } from '../history/finding-lifecycle-types.js';
import type { RealityGapResult, RealityGapServiceDetail } from '../scoring/reality-gap-types.js';
import type { GraphInsight, ReasoningChain, ReasoningScanResult } from './reasoning-types.js';
import {
  detectCascadeFailure,
  detectRecoveryPathErosion,
  detectRiskAcceptanceInvalidation,
  detectSilentDependencyDrift,
} from './graph-insights.js';
import { buildReasoningSteps } from './reasoning-steps.js';

const INSIGHT_SEVERITY_RANK: Readonly<Record<GraphInsight['severity'], number>> = {
  critical: 3,
  high: 2,
  medium: 1,
};

export function buildReasoningChain(
  serviceId: string,
  scanResult: ReasoningScanResult,
  previousScanResult: ReasoningScanResult | null,
  findingLifecycles: readonly FindingLifecycle[] | null,
  realityGap: RealityGapResult,
): ReasoningChain {
  void findingLifecycles;

  const service = scanResult.servicePosture.services.find((entry) => entry.service.id === serviceId);
  if (!service) {
    throw new Error(`Service '${serviceId}' not found.`);
  }

  const realityGapService =
    realityGap.perService.find((entry) => entry.serviceId === service.service.id) ??
    buildFallbackRealityGapService(service);
  const insights = [
    detectCascadeFailure(service.service.id, scanResult),
    detectSilentDependencyDrift(service.service.id, scanResult, previousScanResult),
    detectRiskAcceptanceInvalidation(
      service.service.id,
      scanResult,
      scanResult.governance ?? null,
      previousScanResult,
    ),
    detectRecoveryPathErosion(service.service.id, scanResult, previousScanResult),
  ]
    .filter((insight): insight is GraphInsight => insight !== null)
    .sort(
      (left, right) =>
        INSIGHT_SEVERITY_RANK[right.severity] - INSIGHT_SEVERITY_RANK[left.severity] ||
        left.type.localeCompare(right.type),
    );
  const steps = buildReasoningSteps(service, scanResult, realityGapService);

  return {
    serviceId: service.service.id,
    serviceName: service.service.name,
    score: service.score.score,
    grade: service.score.grade,
    criticality: service.service.criticality,
    claimedProtection: realityGapService.claimedProtection,
    provenRecoverability: realityGapService.provenRecoverability,
    realityGap: realityGapService.realityGap,
    steps,
    insights,
    conclusion: generateConclusion(
      {
        serviceName: service.service.name,
        insights,
        steps,
      },
      realityGapService,
    ),
    nextAction: service.recommendations[0]?.title ?? null,
  };
}

export function generateConclusion(
  chain: Pick<ReasoningChain, 'serviceName' | 'insights' | 'steps'>,
  realityGapService: RealityGapServiceDetail,
): string {
  const criticalFindings = chain.steps.filter(
    (step) => step.type === 'finding' && step.severity === 'critical',
  ).length;
  const totalFindings = chain.steps.filter((step) => step.type === 'finding').length;
  const hasCriticalInsight = chain.insights.some((insight) => insight.severity === 'critical');
  const suffix = chain.insights[0] ? ` Additionally, ${chain.insights[0].summary}` : '';

  if (realityGapService.provenRecoverability === 100) {
    return `${chain.serviceName} is fully proven recoverable. Reality gap: 0.${suffix}`;
  }

  if (realityGapService.provenRecoverability === 0 && hasCriticalInsight) {
    return `${chain.serviceName} is not recoverable. Reality gap: ${realityGapService.realityGap} points. ${criticalFindings} critical finding${criticalFindings === 1 ? '' : 's'} block recovery and no current tested evidence exists.${suffix}`;
  }

  return `${chain.serviceName} has partial coverage. Reality gap: ${realityGapService.realityGap} points. ${totalFindings} finding${totalFindings === 1 ? '' : 's'} remain.${suffix}`;
}

function buildFallbackRealityGapService(
  service: ReasoningScanResult['servicePosture']['services'][number],
): RealityGapServiceDetail {
  return {
    serviceId: service.service.id,
    serviceName: service.service.name,
    criticality: service.service.criticality,
    claimedProtection: 0,
    provenRecoverability: 0,
    realityGap: 0,
    gaps: [],
  };
}
