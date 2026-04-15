import { applyEvidenceFreshness, checkFreshness } from '../evidence/index.js';
import type { DRPComponent, DRPService } from '../drp/drp-types.js';
import { classifyResourceRole, slugifyServiceId } from '../services/index.js';
import type { ServicePostureService } from '../services/service-posture-types.js';
import type { ValidationReport, WeightedValidationResult } from '../validation/index.js';
import type { InfraNodeAttrs } from '../types/index.js';
import type {
  CalculateFullChainCoverageInput,
  EvidenceRecord,
  FullChainResult,
  RecoveryChain,
  RecoveryStep,
  RecoveryStepRole,
} from './recovery-chain-types.js';

const RECOVERY_CATEGORIES = new Set(['backup', 'replication', 'failover', 'recovery']);
const FAILURE_STATUSES = new Set<WeightedValidationResult['status']>(['fail', 'error']);
const WARNING_STATUSES = new Set<WeightedValidationResult['status']>(['warn', 'skip']);
const ROLE_ORDER: Readonly<Record<RecoveryStepRole, number>> = {
  datastore: 0,
  compute: 1,
  network: 2,
  storage: 3,
  other: 4,
};
const ROLE_WEIGHTS: Readonly<Record<RecoveryStepRole, number>> = {
  datastore: 4,
  compute: 3,
  storage: 2,
  network: 1,
  other: 1,
};
const SEVERITY_ORDER: Readonly<Record<WeightedValidationResult['severity'], number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const RECOVERY_CHAIN_DISCLAIMER =
  'This assessment covers AWS-visible infrastructure only. External dependencies, application-level logic, and human coordination are not modeled.';

export function calculateFullChainCoverage(
  input: CalculateFullChainCoverageInput,
): FullChainResult {
  void input.edges;

  const nodeById = new Map(input.nodes.map((node) => [node.id, node] as const));
  const evidenceByNodeId = indexEvidence(
    input.evidenceRecords,
    input.validationReport,
  );
  const services = [...input.servicePosture.services].sort(
    (left, right) =>
      left.service.name.localeCompare(right.service.name) ||
      left.service.id.localeCompare(right.service.id),
  );
  const chains = services.map((service) =>
    buildRecoveryChain(service, input.validationReport, input.drpPlan, nodeById, evidenceByNodeId),
  );
  const weightedTotals = chains.reduce(
    (totals, chain) => ({
      proven: totals.proven + chain.steps.filter((step) => step.status === 'proven').reduce((sum, step) => sum + step.weight, 0),
      total: totals.total + chain.steps.reduce((sum, step) => sum + step.weight, 0),
    }),
    { proven: 0, total: 0 },
  );
  const totalSteps = chains.reduce((sum, chain) => sum + chain.totalSteps, 0);
  const totalProvenSteps = chains.reduce((sum, chain) => sum + chain.provenSteps, 0);

  return {
    chains,
    servicesWithBlockedSteps: chains.filter((chain) => chain.blockedSteps > 0).length,
    servicesFullyProven: chains.filter(
      (chain) => chain.totalSteps > 0 && chain.weightedCoverage === 100,
    ).length,
    globalUnweightedCoverage: percentage(totalProvenSteps, totalSteps),
    globalWeightedCoverage: percentage(weightedTotals.proven, weightedTotals.total),
  };
}

function buildRecoveryChain(
  service: ServicePostureService,
  validationReport: ValidationReport,
  drpPlan: CalculateFullChainCoverageInput['drpPlan'],
  nodeById: ReadonlyMap<string, InfraNodeAttrs>,
  evidenceByNodeId: ReadonlyMap<string, readonly EvidenceRecord[]>,
): RecoveryChain {
  const serviceNodeIds = new Set(service.service.resources.map((resource) => resource.nodeId));
  const drpMatch = matchDrpService(service, drpPlan);
  const orderedItems = drpMatch
    ? buildDrpOrder(service, drpMatch, serviceNodeIds, nodeById)
    : buildDefaultOrder(service, nodeById);
  const steps = orderedItems.map((item, index) =>
    buildRecoveryStep({
      position: index + 1,
      service,
      nodeId: item.nodeId,
      component: item.component,
      node: nodeById.get(item.nodeId) ?? null,
      validationReport,
      evidence: evidenceByNodeId.get(item.nodeId) ?? [],
    }),
  );

  return {
    serviceId: service.service.id,
    serviceName: service.service.name,
    totalSteps: steps.length,
    provenSteps: steps.filter((step) => step.status === 'proven').length,
    observedSteps: steps.filter((step) => step.status === 'observed').length,
    blockedSteps: steps.filter((step) => step.status === 'blocked').length,
    unknownSteps: steps.filter((step) => step.status === 'unknown').length,
    weightedCoverage: percentage(
      steps
        .filter((step) => step.status === 'proven')
        .reduce((sum, step) => sum + step.weight, 0),
      steps.reduce((sum, step) => sum + step.weight, 0),
    ),
    unweightedCoverage: percentage(
      steps.filter((step) => step.status === 'proven').length,
      steps.length,
    ),
    steps,
    disclaimer: RECOVERY_CHAIN_DISCLAIMER,
  };
}

function buildRecoveryStep(input: {
  readonly position: number;
  readonly service: ServicePostureService;
  readonly nodeId: string;
  readonly component: DRPComponent | null;
  readonly node: InfraNodeAttrs | null;
  readonly validationReport: ValidationReport;
  readonly evidence: readonly EvidenceRecord[];
}): RecoveryStep {
  const role = resolveStepRole(input.service, input.nodeId, input.node, input.component);
  const weight = ROLE_WEIGHTS[role];
  const resourceName = resolveResourceName(input.node, input.component, input.nodeId);
  const resourceType = resolveResourceType(input.node, input.component);
  const recoveryAction = resolveRecoveryAction(role, input.component);

  if (!input.node) {
    return {
      position: input.position,
      nodeId: input.nodeId,
      resourceName,
      resourceType,
      role,
      recoveryAction,
      status: 'blocked',
      statusReason: 'Resource no longer exists in infrastructure',
      daysSinceLastTest: null,
      blockingRules: [],
      weight,
    };
  }

  const relevantResults = input.validationReport.results
    .filter(
      (result) =>
        result.nodeId === input.nodeId && RECOVERY_CATEGORIES.has(result.category),
    )
    .slice()
    .sort(compareValidationResults);

  if (relevantResults.length === 0) {
    return {
      position: input.position,
      nodeId: input.nodeId,
      resourceName,
      resourceType,
      role,
      recoveryAction,
      status: 'unknown',
      statusReason: 'No DR rules applicable to this resource type',
      daysSinceLastTest: null,
      blockingRules: [],
      weight,
    };
  }

  const highSeverityFailures = relevantResults.filter(
    (result) =>
      result.status === 'fail' &&
      (result.severity === 'critical' || result.severity === 'high'),
  );
  if (highSeverityFailures.length > 0) {
    const firstBlocking = highSeverityFailures[0];
    return {
      position: input.position,
      nodeId: input.nodeId,
      resourceName,
      resourceType,
      role,
      recoveryAction,
      status: 'blocked',
      statusReason: firstBlocking?.message ?? 'Critical recovery control is failing.',
      daysSinceLastTest: null,
      blockingRules: highSeverityFailures.map((result) => result.ruleId),
      weight,
    };
  }

  const otherFailures = relevantResults.filter((result) => FAILURE_STATUSES.has(result.status));
  if (otherFailures.length > 0) {
    const firstBlocking = otherFailures[0];
    return {
      position: input.position,
      nodeId: input.nodeId,
      resourceName,
      resourceType,
      role,
      recoveryAction,
      status: 'blocked',
      statusReason: firstBlocking?.message ?? 'Recovery validation failed for this step.',
      daysSinceLastTest: null,
      blockingRules: otherFailures.map((result) => result.ruleId),
      weight,
    };
  }

  if (relevantResults.every((result) => result.status === 'pass')) {
    const testedEvidence = input.evidence
      .filter((entry) => entry.type === 'tested')
      .slice()
      .sort(compareEvidenceNewestFirst)[0];
    if (testedEvidence) {
      const daysSinceLastTest = daysSince(
        testedEvidence.timestamp,
        input.validationReport.timestamp,
      );
      return {
        position: input.position,
        nodeId: input.nodeId,
        resourceName,
        resourceType,
        role,
        recoveryAction,
        status: 'proven',
        statusReason: `Tested ${daysSinceLastTest} day${daysSinceLastTest === 1 ? '' : 's'} ago`,
        daysSinceLastTest,
        blockingRules: [],
        weight,
      };
    }

    const expiredEvidence = input.evidence
      .filter((entry) => entry.type === 'expired')
      .map((entry) => ({
        entry,
        freshness: checkFreshness(entry, new Date(input.validationReport.timestamp)),
      }))
      .slice()
      .sort((left, right) => compareEvidenceNewestFirst(left.entry, right.entry))[0];
    if (expiredEvidence?.freshness.status === 'expired') {
      const daysExpired = Math.max(1, Math.abs(expiredEvidence.freshness.daysUntilExpiry ?? 1));
      return {
        position: input.position,
        nodeId: input.nodeId,
        resourceName,
        resourceType,
        role,
        recoveryAction,
        status: 'observed',
        statusReason: `Evidence expired ${daysExpired} day${daysExpired === 1 ? '' : 's'} ago`,
        daysSinceLastTest: null,
        blockingRules: [],
        weight,
      };
    }

    const hasObservedEvidence = input.evidence.some((entry) =>
      entry.type === 'observed' || entry.type === 'declared' || entry.type === 'inferred',
    );
    return {
      position: input.position,
      nodeId: input.nodeId,
      resourceName,
      resourceType,
      role,
      recoveryAction,
      status: 'observed',
      statusReason: hasObservedEvidence
        ? 'Configuration observed but never tested'
        : 'Passing rules but no evidence recorded',
      daysSinceLastTest: null,
      blockingRules: [],
      weight,
    };
  }

  const warningResult = relevantResults.find((result) => WARNING_STATUSES.has(result.status));
  return {
    position: input.position,
    nodeId: input.nodeId,
    resourceName,
    resourceType,
    role,
    recoveryAction,
    status: 'observed',
    statusReason:
      warningResult?.message ??
      'Recovery validation is incomplete for this resource',
    daysSinceLastTest: null,
    blockingRules: [],
    weight,
  };
}

function matchDrpService(
  service: ServicePostureService,
  drpPlan: CalculateFullChainCoverageInput['drpPlan'],
): { readonly service: DRPService; readonly kind: 'exact' | 'overlap' } | null {
  if (!drpPlan) {
    return null;
  }

  const normalizedServiceId = service.service.id.toLowerCase();
  const normalizedServiceName = service.service.name.toLowerCase();
  const exact = drpPlan.services.find((candidate) => {
    const candidateName = candidate.name.toLowerCase();
    const candidateSlug = slugifyServiceId(candidate.name);
    return (
      candidateName === normalizedServiceName ||
      candidateName === normalizedServiceId ||
      candidateSlug === normalizedServiceId
    );
  });
  if (exact) {
    return { service: exact, kind: 'exact' };
  }

  const serviceNodeIds = new Set(service.service.resources.map((resource) => resource.nodeId));
  const overlap = drpPlan.services
    .map((candidate) => ({
      service: candidate,
      overlap: candidate.components.filter((component) => serviceNodeIds.has(component.resourceId)).length,
    }))
    .filter((candidate) => candidate.overlap > 0)
    .sort(
      (left, right) =>
        right.overlap - left.overlap ||
        left.service.name.localeCompare(right.service.name),
    )[0];

  return overlap ? { service: overlap.service, kind: 'overlap' } : null;
}

function buildDrpOrder(
  service: ServicePostureService,
  match: NonNullable<ReturnType<typeof matchDrpService>>,
  serviceNodeIds: ReadonlySet<string>,
  nodeById: ReadonlyMap<string, InfraNodeAttrs>,
): ReadonlyArray<{ readonly nodeId: string; readonly component: DRPComponent | null }> {
  const componentById = new Map(
    match.service.components.map((component) => [component.resourceId, component] as const),
  );
  const orderedIds = match.service.recoveryOrder.length > 0
    ? [...match.service.recoveryOrder]
    : match.service.components.map((component) => component.resourceId);
  const items: Array<{ readonly nodeId: string; readonly component: DRPComponent | null }> = [];
  const seen = new Set<string>();

  orderedIds.forEach((nodeId) => {
    const component = componentById.get(nodeId) ?? null;
    if (!nodeId || seen.has(nodeId)) {
      return;
    }
    if (match.kind === 'overlap' && !serviceNodeIds.has(nodeId)) {
      return;
    }
    seen.add(nodeId);
    items.push({ nodeId, component });
  });
  if (match.kind === 'exact') {
    match.service.components.forEach((component) => {
      if (seen.has(component.resourceId)) {
        return;
      }
      seen.add(component.resourceId);
      items.push({ nodeId: component.resourceId, component });
    });
  }

  const remainingItems = buildDefaultOrder(service, nodeById)
    .filter((item) => !seen.has(item.nodeId));
  return [...items, ...remainingItems];
}

function buildDefaultOrder(
  service: ServicePostureService,
  nodeById: ReadonlyMap<string, InfraNodeAttrs>,
): ReadonlyArray<{ readonly nodeId: string; readonly component: DRPComponent | null }> {
  return service.service.resources
    .map((resource) => ({
      nodeId: resource.nodeId,
      component: null,
      role: normalizeRole(resource.role ?? resolveRoleFromNode(nodeById.get(resource.nodeId) ?? null)),
      blastRadius: nodeById.get(resource.nodeId)?.blastRadius ?? 0,
      name: resolveResourceName(nodeById.get(resource.nodeId) ?? null, null, resource.nodeId),
    }))
    .sort(
      (left, right) =>
        ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
        right.blastRadius - left.blastRadius ||
        left.name.localeCompare(right.name) ||
        left.nodeId.localeCompare(right.nodeId),
    )
    .map(({ nodeId, component }) => ({ nodeId, component }));
}

function indexEvidence(
  evidenceRecords: readonly EvidenceRecord[] | null,
  validationReport: ValidationReport,
): ReadonlyMap<string, readonly EvidenceRecord[]> {
  const asOf = new Date(validationReport.timestamp);
  const evidence = (evidenceRecords ?? collectEvidenceFromValidationReport(validationReport))
    .map((entry) => applyEvidenceFreshness(entry, asOf))
    .sort(compareEvidenceNewestFirst);
  const grouped = new Map<string, EvidenceRecord[]>();

  evidence.forEach((entry) => {
    const current = grouped.get(entry.subject.nodeId) ?? [];
    if (!current.some((candidate) => candidate.id === entry.id)) {
      current.push(entry);
      grouped.set(entry.subject.nodeId, current);
    }
  });

  return grouped;
}

function collectEvidenceFromValidationReport(
  validationReport: ValidationReport,
): readonly EvidenceRecord[] {
  return validationReport.results.flatMap((result) =>
    'evidence' in result && Array.isArray(result.evidence) ? result.evidence : [],
  );
}

function resolveStepRole(
  service: ServicePostureService,
  nodeId: string,
  node: InfraNodeAttrs | null,
  component: DRPComponent | null,
): RecoveryStepRole {
  const resource = service.service.resources.find((entry) => entry.nodeId === nodeId);
  if (resource?.role) {
    return normalizeRole(resource.role);
  }
  if (node) {
    return normalizeRole(classifyResourceRole(node));
  }
  if (component) {
    return inferRoleFromResourceType(component.resourceType);
  }
  return 'other';
}

function resolveRoleFromNode(node: InfraNodeAttrs | null): RecoveryStepRole {
  return node ? normalizeRole(classifyResourceRole(node)) : 'other';
}

function normalizeRole(role: string): RecoveryStepRole {
  if (role === 'datastore' || role === 'compute' || role === 'network' || role === 'storage') {
    return role;
  }
  if (role === 'dns') {
    return 'network';
  }
  return 'other';
}

function inferRoleFromResourceType(resourceType: string): RecoveryStepRole {
  const normalized = resourceType.trim().toLowerCase();
  if (normalized.includes('rds') || normalized.includes('aurora') || normalized.includes('dynamo') || normalized.includes('cache') || normalized.includes('database')) {
    return 'datastore';
  }
  if (normalized.includes('ec2') || normalized.includes('lambda') || normalized.includes('eks') || normalized.includes('vm') || normalized.includes('compute') || normalized.includes('serverless')) {
    return 'compute';
  }
  if (normalized.includes('s3') || normalized.includes('efs') || normalized.includes('storage')) {
    return 'storage';
  }
  if (normalized.includes('dns') || normalized.includes('route53') || normalized.includes('load_balancer') || normalized.includes('load-balancer') || normalized.includes('elb') || normalized.includes('api_gateway') || normalized.includes('api-gateway')) {
    return 'network';
  }
  return 'other';
}

function resolveResourceName(
  node: InfraNodeAttrs | null,
  component: DRPComponent | null,
  nodeId: string,
): string {
  return (
    node?.displayName ??
    node?.businessName ??
    node?.name ??
    component?.name ??
    nodeId
  );
}

function resolveResourceType(node: InfraNodeAttrs | null, component: DRPComponent | null): string {
  const rawType =
    (typeof node?.metadata.sourceType === 'string' && node.metadata.sourceType) ||
    component?.resourceType ||
    node?.type ||
    'unknown';
  return rawType.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function resolveRecoveryAction(
  role: RecoveryStepRole,
  component: DRPComponent | null,
): string {
  if (component) {
    switch (component.recoveryStrategy) {
      case 'aurora_failover':
      case 'aurora_global_failover':
      case 'failover':
      case 'dns_failover':
        return 'failover';
      case 'restore_from_backup':
        return 'restore from backup';
      case 'auto_scaling':
      case 'rebuild':
        return 'redeploy';
      case 'manual':
      case 'none':
      default:
        return 'manual recovery';
    }
  }

  if (role === 'datastore') return 'restore';
  if (role === 'compute') return 'redeploy';
  if (role === 'network') return 'reconfigure';
  return 'recover';
}

function compareValidationResults(
  left: WeightedValidationResult,
  right: WeightedValidationResult,
): number {
  return (
    SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity] ||
    right.status.localeCompare(left.status) ||
    left.ruleId.localeCompare(right.ruleId)
  );
}

function compareEvidenceNewestFirst(left: EvidenceRecord, right: EvidenceRecord): number {
  return (
    right.timestamp.localeCompare(left.timestamp) ||
    left.id.localeCompare(right.id)
  );
}

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 100);
}

function daysSince(fromTimestamp: string, toTimestamp: string): number {
  const from = Date.parse(fromTimestamp);
  const to = Date.parse(toTimestamp);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return 0;
  }
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}
