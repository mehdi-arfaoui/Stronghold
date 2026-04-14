import { generateRunbook } from '../drp/runbook/runbook-generator.js';
import { validateRunbookLiveness } from '../scenarios/runbook-validator.js';
import type { ServicePostureService } from '../services/index.js';
import type { Scenario, StaleReference } from '../scenarios/scenario-types.js';
import type { InfraNodeAttrs } from '../types/infrastructure.js';
import type { WeightedValidationResult } from '../validation/index.js';
import type {
  CalculateRealityGapInput,
  RealityGapReason,
  RealityGapResult,
  RealityGapServiceDetail,
} from './reality-gap-types.js';

const CLAIMED_STATUSES = new Set<WeightedValidationResult['status']>(['pass', 'warn', 'fail']);
const PROVEN_SCENARIO_VERDICTS = new Set(['covered', 'partially_covered']);
const APPLICATION_ROLES = new Set(['compute', 'datastore']);
const GAP_REASON_RANK: Readonly<Record<RealityGapReason['type'], number>> = {
  no_tested_evidence: 1,
  expired_evidence: 2,
  scenario_uncovered: 3,
  runbook_broken: 4,
  unmitigated_spof: 5,
  no_cross_region: 6,
  single_az: 7,
};

export function calculateRealityGap(input: CalculateRealityGapInput): RealityGapResult {
  const validationResults = getValidationResults(input.validationReport);
  const services = [...(input.servicePosture?.services ?? [])].sort(
    (left, right) =>
      left.service.name.localeCompare(right.service.name) ||
      left.service.id.localeCompare(right.service.id),
  );
  const runbookStalenessByService = buildRunbookStalenessIndex(input);
  const perService = services.map((service) =>
    summarizeServiceRealityGap(service, input, runbookStalenessByService.get(service.service.id) ?? []),
  );
  const criticalServices = perService.filter((service) => service.criticality === 'critical');
  const denominatorServices = criticalServices.length > 0 ? criticalServices : perService;
  const claimedProtection = calculateClaimedProtection(validationResults);
  const provenRecoverability =
    denominatorServices.length === 0
      ? null
      : percentage(
          denominatorServices.filter((service) => service.provenRecoverability === 100).length,
          denominatorServices.length,
        );

  return {
    claimedProtection,
    provenRecoverability,
    realityGap:
      provenRecoverability === null ? null : Math.max(0, claimedProtection - provenRecoverability),
    perService,
  };
}

function summarizeServiceRealityGap(
  service: ServicePostureService,
  input: CalculateRealityGapInput,
  staleReferences: readonly StaleReference[],
): RealityGapServiceDetail {
  const nodeIds = new Set(service.service.resources.map((resource) => resource.nodeId));
  const nodes = getInputNodes(input);
  const serviceResults = getValidationResults(input.validationReport).filter((result) =>
    nodeIds.has(result.nodeId),
  );
  const passingResults = serviceResults.filter((result) => result.status === 'pass');
  const testedResults = passingResults.filter((result) => resolveEvidenceType(result) === 'tested');
  const expiredResult = resolveExpiredEvidence(passingResults, input.validationReport.timestamp);
  const affectedScenarios = collectAffectedScenarios(service.service.id, input.scenarioAnalysis?.scenarios ?? []);
  const uncoveredScenarios = affectedScenarios.filter(
    (scenario) => !PROVEN_SCENARIO_VERDICTS.has(scenario.verdict),
  );
  const spofs = nodes
    .filter((node) => nodeIds.has(node.id))
    .filter(
      (node) => (node.isSPOF === true || (node.blastRadius ?? 0) > 2) && (node.blastRadius ?? 0) > 2,
    )
    .slice()
    .sort(
      (left, right) =>
        (right.blastRadius ?? 0) - (left.blastRadius ?? 0) || left.id.localeCompare(right.id),
    );
  const gaps: RealityGapReason[] = [];

  if (testedResults.length === 0) {
    if (expiredResult) {
      gaps.push({
        type: 'expired_evidence',
        detail: `Latest tested recovery evidence expired ${expiredResult.daysExpired} day${expiredResult.daysExpired === 1 ? '' : 's'} ago.`,
        daysExpired: expiredResult.daysExpired,
      });
    } else {
      gaps.push({
        type: 'no_tested_evidence',
        detail: 'No passing recovery rule has current tested evidence.',
      });
    }
  }

  uncoveredScenarios.forEach((scenario) => {
    gaps.push({
      type: 'scenario_uncovered',
      scenarioId: scenario.id,
      scenarioName: scenario.name,
    });
  });

  if (staleReferences.length > 0) {
    gaps.push({
      type: 'runbook_broken',
      staleResources: Array.from(
        new Set(staleReferences.map((reference) => reference.referencedResourceId)),
      ).sort((left, right) => left.localeCompare(right)),
    });
  }

  spofs.forEach((node) => {
    gaps.push({
      type: 'unmitigated_spof',
      nodeId: node.id,
      blastRadius: node.blastRadius ?? 0,
    });
  });

  const hasTestedEvidence = testedResults.length > 0;
  const scenariosCovered = uncoveredScenarios.length === 0;
  const runbookValid = staleReferences.length === 0;
  const spofsMitigated = spofs.length === 0;
  if (!hasTestedEvidence || !scenariosCovered || !runbookValid || !spofsMitigated) {
    gaps.push(...collectTopologyGaps(service, nodes));
  }
  const provenRecoverability =
    hasTestedEvidence && scenariosCovered && runbookValid && spofsMitigated ? 100 : 0;
  const claimedProtection = calculateClaimedProtection(serviceResults);

  return {
    serviceId: service.service.id,
    serviceName: service.service.name,
    criticality: service.service.criticality,
    claimedProtection,
    provenRecoverability,
    realityGap: Math.max(0, claimedProtection - provenRecoverability),
    gaps: gaps.sort(compareGapReasons),
  };
}

function calculateClaimedProtection(results: readonly WeightedValidationResult[]): number {
  const relevant = results.filter((result) => CLAIMED_STATUSES.has(result.status));
  if (relevant.length === 0) {
    return 0;
  }

  const protectedCount = relevant.filter(
    (result) => result.status === 'pass' || result.status === 'warn',
  ).length;
  return percentage(protectedCount, relevant.length);
}

function getValidationResults(
  report: CalculateRealityGapInput['validationReport'],
): readonly WeightedValidationResult[] {
  return Array.isArray(report.results) ? report.results : [];
}

function getInputNodes(input: CalculateRealityGapInput): readonly InfraNodeAttrs[] {
  return Array.isArray(input.nodes) ? input.nodes : [];
}

function buildRunbookStalenessIndex(
  input: CalculateRealityGapInput,
): ReadonlyMap<string, readonly StaleReference[]> {
  const nodes = getInputNodes(input);
  if (!input.drpPlan || !input.servicePosture || nodes.length === 0) {
    return new Map();
  }

  const runbook = generateRunbook(input.drpPlan, nodes);

  return new Map(
    input.servicePosture.services.map((service) => {
      const nodeIds = new Set(service.service.resources.map((resource) => resource.nodeId));
      const componentRunbooks = runbook.componentRunbooks.filter((component) =>
        nodeIds.has(component.componentId),
      );
      if (componentRunbooks.length === 0) {
        return [service.service.id, []] as const;
      }

      return [
        service.service.id,
        validateRunbookLiveness(
          {
            ...runbook,
            componentRunbooks,
          },
          nodes,
        ).staleReferences,
      ] as const;
    }),
  );
}

function collectAffectedScenarios(
  serviceId: string,
  scenarios: readonly Scenario[],
): ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly verdict: string;
}> {
  return scenarios
    .flatMap((scenario) => {
      const detail = scenario.coverage?.details.find((entry) => entry.serviceId === serviceId);
      const impact = scenario.impact?.serviceImpact.find((entry) => entry.serviceId === serviceId);
      if (!detail && (!impact || impact.status === 'unaffected')) {
        return [];
      }

      return [
        {
          id: scenario.id,
          name: scenario.name,
          verdict: detail?.verdict ?? scenario.coverage?.verdict ?? 'uncovered',
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function collectTopologyGaps(
  service: ServicePostureService,
  nodes: readonly InfraNodeAttrs[],
): readonly RealityGapReason[] {
  const serviceNodes = service.service.resources
    .map((resource) => nodes.find((node) => node.id === resource.nodeId))
    .filter((node): node is InfraNodeAttrs => node !== undefined);
  const applicationNodes = serviceNodes.filter((node) => {
    const resource = service.service.resources.find((entry) => entry.nodeId === node.id);
    return APPLICATION_ROLES.has(resource?.role ?? 'other');
  });
  const regions = Array.from(
    new Set(
      applicationNodes
        .map((node) => node.region)
        .filter((region): region is string => typeof region === 'string' && region.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const azs = Array.from(
    new Set(
      applicationNodes
        .map((node) => node.availabilityZone)
        .filter((az): az is string => typeof az === 'string' && az.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const gaps: RealityGapReason[] = [];

  if (applicationNodes.length > 0 && regions.length <= 1) {
    gaps.push({
      type: 'no_cross_region',
      detail:
        regions.length === 1
          ? `Service resources are only present in ${regions[0]}.`
          : 'Service resources do not expose a second recovery region.',
    });
  }

  if (applicationNodes.length > 0 && azs.length <= 1) {
    gaps.push({
      type: 'single_az',
      detail:
        azs.length === 1
          ? `Service resources are concentrated in ${azs[0]}.`
          : 'Service resources do not expose multi-AZ placement.',
    });
  }

  return gaps;
}

function resolveExpiredEvidence(
  results: readonly WeightedValidationResult[],
  asOfTimestamp: string,
): { readonly daysExpired: number } | null {
  const asOf = Date.parse(asOfTimestamp);
  const expiredEvidence = results
    .flatMap((result) =>
      'evidence' in result && Array.isArray(result.evidence) ? result.evidence : [],
    )
    .filter(
      (evidence) =>
        evidence.type === 'expired' ||
        (typeof evidence.expiresAt === 'string' &&
          Number.isFinite(asOf) &&
          Date.parse(evidence.expiresAt) < asOf),
    )
    .map((evidence) => {
      const expiresAt = evidence.expiresAt ? Date.parse(evidence.expiresAt) : Number.NaN;
      const daysExpired =
        Number.isFinite(asOf) && Number.isFinite(expiresAt)
          ? Math.max(1, Math.round((asOf - expiresAt) / 86_400_000))
          : 1;
      return { daysExpired };
    })
    .sort((left, right) => right.daysExpired - left.daysExpired);

  return expiredEvidence[0] ?? null;
}

function resolveEvidenceType(result: WeightedValidationResult): string | null {
  if ('weightBreakdown' in result && 'evidenceType' in result.weightBreakdown) {
    const evidenceType = (result.weightBreakdown as { readonly evidenceType?: unknown }).evidenceType;
    return typeof evidenceType === 'string' ? evidenceType : null;
  }

  if ('evidence' in result && Array.isArray(result.evidence) && result.evidence.length > 0) {
    const strongest = result.evidence
      .slice()
      .sort((left, right) => evidenceRank(right.type) - evidenceRank(left.type))[0];
    return strongest?.type ?? null;
  }

  return null;
}

function evidenceRank(type: string): number {
  if (type === 'tested') return 5;
  if (type === 'expired') return 4;
  if (type === 'observed') return 3;
  if (type === 'declared') return 2;
  if (type === 'inferred') return 1;
  return 0;
}

function compareGapReasons(left: RealityGapReason, right: RealityGapReason): number {
  if (GAP_REASON_RANK[left.type] !== GAP_REASON_RANK[right.type]) {
    return GAP_REASON_RANK[left.type] - GAP_REASON_RANK[right.type];
  }

  return gapSortValue(left).localeCompare(gapSortValue(right));
}

function gapSortValue(reason: RealityGapReason): string {
  switch (reason.type) {
    case 'expired_evidence':
      return String(reason.daysExpired).padStart(4, '0');
    case 'scenario_uncovered':
      return `${reason.scenarioName}:${reason.scenarioId}`;
    case 'runbook_broken':
      return reason.staleResources.join(',');
    case 'unmitigated_spof':
      return `${String(reason.blastRadius).padStart(4, '0')}:${reason.nodeId}`;
    case 'no_cross_region':
    case 'single_az':
    case 'no_tested_evidence':
    default:
      return reason.detail;
  }
}

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return Math.round((numerator / denominator) * 100);
}
