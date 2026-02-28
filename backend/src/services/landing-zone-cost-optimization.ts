import type { DrStrategyKey } from '../constants/dr-financial-reference-data.js';
import { resolveServiceResolution } from './dr-recommendation-engine/recommendationEngine.js';
import { asRecord, readStringFromKeys } from './dr-recommendation-engine/metadataUtils.js';

export type RecommendationCostSeed = {
  id: string;
  nodeId: string;
  serviceName: string;
  strategyKey: DrStrategyKey;
  estimatedCost: number;
  estimatedAnnualCost: number;
  estimatedProductionMonthlyCost: number;
  nodeType: string;
  provider: string;
  metadata?: unknown;
  priority: number;
};

export type RecommendationCostAllocation = {
  id: string;
  groupKey: string | null;
  allocatedMonthlyCost: number;
  allocatedAnnualCost: number;
  countedInSummary: boolean;
  allocationShare: number;
};

export type RecommendationRoiCandidate = {
  id: string;
  annualCost: number;
  roi: number | null;
  riskAvoidedAnnual: number;
  priority: number;
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function normalizeKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function strategyScopedGroupKey(baseGroupKey: string | null, strategyKey: DrStrategyKey): string | null {
  if (!baseGroupKey) return null;
  return `${baseGroupKey}:${strategyKey}`;
}

export function deriveRecommendationGroupKey(input: {
  strategyKey: DrStrategyKey;
  nodeType: string;
  provider: string;
  metadata?: unknown;
}): string | null {
  const metadata = asRecord(input.metadata);
  const explicitGroupKey = normalizeKey(
    metadata.drCostGroupKey ??
      metadata.drGroupKey ??
      metadata.groupKey,
  );
  if (explicitGroupKey) {
    return strategyScopedGroupKey(explicitGroupKey, input.strategyKey);
  }

  const resolution = resolveServiceResolution({
    nodeType: input.nodeType,
    provider: input.provider,
    metadata,
  });

  const clusterKey = normalizeKey(
    readStringFromKeys(metadata, [
      'clusterId',
      'dbClusterIdentifier',
      'cacheClusterId',
      'kubernetesClusterId',
      'eksClusterId',
    ]),
  );
  if (
    clusterKey &&
    (
      resolution.kind === 'rds' ||
      resolution.kind === 'elasticache' ||
      resolution.kind === 'ec2' ||
      resolution.kind === 'eks' ||
      ['APPLICATION', 'MICROSERVICE', 'CONTAINER', 'KUBERNETES_POD', 'KUBERNETES_SERVICE'].includes(
        String(input.nodeType || '').toUpperCase(),
      )
    )
  ) {
    return strategyScopedGroupKey(`${resolution.provider}:cluster:${clusterKey}`, input.strategyKey);
  }

  const replicationProgramKey = normalizeKey(
    readStringFromKeys(metadata, ['replicationProgramKey', 'replicationProgram', 'storageProgramKey']),
  );
  if (replicationProgramKey && (resolution.kind === 's3' || String(input.nodeType).toUpperCase() === 'OBJECT_STORAGE')) {
    return strategyScopedGroupKey(`${resolution.provider}:storage:${replicationProgramKey}`, input.strategyKey);
  }

  const ingressProgramKey = normalizeKey(
    readStringFromKeys(metadata, ['ingressProgramKey', 'trafficProgramKey']),
  );
  if (
    ingressProgramKey &&
    ['LOAD_BALANCER', 'API_GATEWAY', 'DNS'].includes(String(input.nodeType || '').toUpperCase())
  ) {
    return strategyScopedGroupKey(`${resolution.provider}:ingress:${ingressProgramKey}`, input.strategyKey);
  }

  return null;
}

export function allocateRecommendationCosts(
  seeds: RecommendationCostSeed[],
): RecommendationCostAllocation[] {
  const groups = new Map<string, RecommendationCostSeed[]>();
  const allocations: RecommendationCostAllocation[] = [];

  for (const seed of seeds) {
    const groupKey = deriveRecommendationGroupKey({
      strategyKey: seed.strategyKey,
      nodeType: seed.nodeType,
      provider: seed.provider,
      metadata: seed.metadata,
    });
    if (!groupKey) {
      allocations.push({
        id: seed.id,
        groupKey: null,
        allocatedMonthlyCost: roundMoney(seed.estimatedCost),
        allocatedAnnualCost: roundMoney(seed.estimatedAnnualCost),
        countedInSummary: true,
        allocationShare: 1,
      });
      continue;
    }
    const bucket = groups.get(groupKey) ?? [];
    bucket.push(seed);
    groups.set(groupKey, bucket);
  }

  for (const [groupKey, members] of groups.entries()) {
    const sharedMonthlyCost = roundMoney(
      members.reduce(
        (highest, member) => Math.max(highest, Number(member.estimatedCost) || 0),
        0,
      ),
    );
    const weightTotal =
      members.reduce(
        (sum, member) =>
          sum + Math.max(1, Number(member.estimatedProductionMonthlyCost) || Number(member.estimatedCost) || 1),
        0,
      ) || members.length;

    let allocatedMonthlySum = 0;
    members.forEach((member, index) => {
      const weight = Math.max(
        1,
        Number(member.estimatedProductionMonthlyCost) || Number(member.estimatedCost) || 1,
      );
      const isLast = index === members.length - 1;
      const allocatedMonthlyCost = isLast
        ? roundMoney(Math.max(0, sharedMonthlyCost - allocatedMonthlySum))
        : roundMoney((sharedMonthlyCost * weight) / weightTotal);
      allocatedMonthlySum += allocatedMonthlyCost;
      allocations.push({
        id: member.id,
        groupKey,
        allocatedMonthlyCost,
        allocatedAnnualCost: roundMoney(allocatedMonthlyCost * 12),
        countedInSummary: true,
        allocationShare: roundMoney(weight / weightTotal),
      });
    });
  }

  return allocations;
}

export function partitionRecommendationsByAleCap(
  candidates: RecommendationRoiCandidate[],
  aleTotal: number,
  maxCostShare = 0.35,
): {
  primaryIds: Set<string>;
  secondaryIds: Set<string>;
  annualCap: number;
  primaryAnnualCost: number;
} {
  const annualCap = roundMoney(Math.max(0, aleTotal) * Math.max(0, maxCostShare));
  const ordered = [...candidates].sort((left, right) => {
    const leftRoi = left.roi == null || !Number.isFinite(left.roi) ? Number.NEGATIVE_INFINITY : left.roi;
    const rightRoi = right.roi == null || !Number.isFinite(right.roi) ? Number.NEGATIVE_INFINITY : right.roi;
    if (rightRoi !== leftRoi) return rightRoi - leftRoi;
    if (right.riskAvoidedAnnual !== left.riskAvoidedAnnual) {
      return right.riskAvoidedAnnual - left.riskAvoidedAnnual;
    }
    if (left.annualCost !== right.annualCost) return left.annualCost - right.annualCost;
    return right.priority - left.priority;
  });

  const primaryIds = new Set<string>();
  const secondaryIds = new Set<string>();
  let runningAnnualCost = 0;

  for (const candidate of ordered) {
    const annualCost = roundMoney(Math.max(0, candidate.annualCost));
    const canFit = annualCost <= 0 || runningAnnualCost + annualCost <= annualCap;
    if (canFit) {
      primaryIds.add(candidate.id);
      runningAnnualCost = roundMoney(runningAnnualCost + annualCost);
    } else {
      secondaryIds.add(candidate.id);
    }
  }

  return {
    primaryIds,
    secondaryIds,
    annualCap,
    primaryAnnualCost: runningAnnualCost,
  };
}
