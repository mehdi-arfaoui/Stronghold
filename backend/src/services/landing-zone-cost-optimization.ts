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

export type StrategyCostBreakdownEntry = {
  strategy: string;
  absoluteCost: number;
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
  return seeds.map((seed) => ({
    id: seed.id,
    groupKey: deriveRecommendationGroupKey({
      strategyKey: seed.strategyKey,
      nodeType: seed.nodeType,
      provider: seed.provider,
      metadata: seed.metadata,
    }),
    allocatedMonthlyCost: roundMoney(seed.estimatedCost),
    allocatedAnnualCost: roundMoney(seed.estimatedAnnualCost),
    countedInSummary: true,
    allocationShare: 1,
  }));
}

export function partitionRecommendationsByAleCap(
  candidates: RecommendationRoiCandidate[],
  aleTotal: number,
  maxCostShare = 0.35,
  explicitAnnualCap?: number | null,
): {
  primaryIds: Set<string>;
  secondaryIds: Set<string>;
  annualCap: number;
  primaryAnnualCost: number;
} {
  const annualCap =
    Number(explicitAnnualCap) > 0
      ? roundMoney(Number(explicitAnnualCap))
      : roundMoney(Math.max(0, aleTotal) * Math.max(0, maxCostShare));
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

export function normalizeStrategyCostPercentages(
  entries: StrategyCostBreakdownEntry[],
): Record<string, number> {
  const normalizedEntries = entries
    .map((entry) => ({
      strategy: entry.strategy,
      absoluteCost: roundMoney(Math.max(0, Number(entry.absoluteCost) || 0)),
    }))
    .filter((entry) => entry.strategy.length > 0 && entry.absoluteCost > 0);

  const totalCost = roundMoney(
    normalizedEntries.reduce((sum, entry) => sum + entry.absoluteCost, 0),
  );
  if (totalCost <= 0 || normalizedEntries.length === 0) {
    return {};
  }

  const allocation = normalizedEntries.map((entry, index) => {
    const rawPercent = (entry.absoluteCost / totalCost) * 100;
    const flooredPercent = Math.floor(rawPercent);
    return {
      ...entry,
      index,
      rawPercent,
      flooredPercent,
      remainder: rawPercent - flooredPercent,
    };
  });

  let remainingPercent = 100 - allocation.reduce((sum, entry) => sum + entry.flooredPercent, 0);
  const bumpOrder = [...allocation].sort((left, right) => {
    if (right.remainder !== left.remainder) {
      return right.remainder - left.remainder;
    }
    if (right.absoluteCost !== left.absoluteCost) {
      return right.absoluteCost - left.absoluteCost;
    }
    return left.strategy.localeCompare(right.strategy);
  });

  const integerPercents = new Map<number, number>(
    allocation.map((entry) => [entry.index, entry.flooredPercent]),
  );

  for (const entry of bumpOrder) {
    if (remainingPercent <= 0) break;
    integerPercents.set(entry.index, (integerPercents.get(entry.index) || 0) + 1);
    remainingPercent -= 1;
  }

  return Object.fromEntries(
    allocation.map((entry) => [entry.strategy, integerPercents.get(entry.index) || 0]),
  );
}
