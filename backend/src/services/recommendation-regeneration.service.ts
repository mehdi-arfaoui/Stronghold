import type { Prisma, PrismaClient } from '@prisma/client';
import type { RecommendationRuleNode, ResilienceRule } from './dr-recommendation-engine/rules/types.js';
import {
  ALL_RULES,
  buildRecommendationRuleNode,
  isNodeResilientByDesign,
} from './dr-recommendation-engine/rules/index.js';
import {
  buildLandingZoneFinancialContext,
  type LandingZoneFinancialContext,
} from './landing-zone-financial.service.js';

type NodeSnapshot = {
  id: string;
  name: string;
  type: string;
  provider: string;
  region: string | null;
  availabilityZone: string | null;
  metadata: unknown;
};

type NodeMetadataSnapshot = {
  id: string;
  metadata: unknown;
};

type PrismaDbClient = PrismaClient | Prisma.TransactionClient;

type CoverageCounters = {
  resilientByDesign: number;
  noRuleApplicable: number;
};

export type RecommendationRegenerationResult = {
  totalNodes: number;
  recommendationsGenerated: number;
  resilientByDesign: number;
  noRuleApplicable: number;
  requiresVerification: number;
  totalDrCostMonthly: number;
  totalDrCostAnnual: number;
  financialProfileConfigured: boolean;
};

const RECOMMENDATION_METADATA_KEYS = [
  'landingZoneRecommendation',
  'landingZoneAccepted',
  'recoveryStrategy',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toPrismaJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function hasRecommendationMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return RECOMMENDATION_METADATA_KEYS.some((key) => key in value);
}

function stripRecommendationMetadata(value: unknown): Record<string, unknown> {
  const nextMetadata = isRecord(value) ? { ...value } : {};
  for (const key of RECOMMENDATION_METADATA_KEYS) {
    delete nextMetadata[key];
  }
  return nextMetadata;
}

function safeRuleApplies(rule: ResilienceRule, node: RecommendationRuleNode): boolean {
  try {
    if (rule.provider !== '*' && rule.provider !== node.provider) {
      return false;
    }
    return rule.appliesTo(node);
  } catch {
    return false;
  }
}

function safeRuleIsSatisfied(rule: ResilienceRule, node: RecommendationRuleNode): boolean {
  try {
    return rule.isSatisfied(node);
  } catch {
    return false;
  }
}

function computeCoverageCounters(nodes: NodeSnapshot[]): CoverageCounters {
  let resilientByDesign = 0;
  let noRuleApplicable = 0;

  for (const node of nodes) {
    const ruleNode = buildRecommendationRuleNode({
      id: node.id,
      name: node.name,
      nodeType: node.type,
      provider: node.provider,
      metadata: node.metadata,
      region: node.region,
      availabilityZone: node.availabilityZone,
    });

    if (isNodeResilientByDesign(ruleNode)) {
      resilientByDesign += 1;
      continue;
    }

    const applicableRules = ALL_RULES.filter((rule) => safeRuleApplies(rule, ruleNode));
    if (applicableRules.length === 0) {
      noRuleApplicable += 1;
      continue;
    }

    const allSatisfied = applicableRules.every((rule) => safeRuleIsSatisfied(rule, ruleNode));
    if (allSatisfied) {
      resilientByDesign += 1;
    }
  }

  return {
    resilientByDesign,
    noRuleApplicable,
  };
}

async function clearPersistedRecommendations(
  prismaClient: PrismaDbClient,
  tenantId: string,
): Promise<void> {
  const nodes = await prismaClient.infraNode.findMany({
    where: { tenantId },
    select: {
      id: true,
      metadata: true,
    },
  });

  for (const node of nodes) {
    if (!hasRecommendationMetadata(node.metadata)) continue;
    const cleanedMetadata = stripRecommendationMetadata(node.metadata);
    await prismaClient.infraNode.updateMany({
      where: {
        id: node.id,
        tenantId,
      },
      data: {
        metadata: toPrismaJson(cleanedMetadata),
      },
    });
  }
}

async function persistPendingRecommendationState(
  prismaClient: PrismaDbClient,
  tenantId: string,
  context: LandingZoneFinancialContext,
  updatedAtIso: string,
): Promise<void> {
  const targetNodeIds = Array.from(new Set(context.recommendations.map((recommendation) => recommendation.nodeId)));
  if (targetNodeIds.length === 0) return;

  const targetNodes: NodeMetadataSnapshot[] = await prismaClient.infraNode.findMany({
    where: {
      tenantId,
      id: { in: targetNodeIds },
    },
    select: {
      id: true,
      metadata: true,
    },
  });

  for (const node of targetNodes) {
    const baseMetadata = stripRecommendationMetadata(node.metadata);
    const nextMetadata: Record<string, unknown> = {
      ...baseMetadata,
      landingZoneAccepted: null,
      landingZoneRecommendation: {
        status: 'pending',
        notes: null,
        updatedAt: updatedAtIso,
        history: [],
      },
    };

    await prismaClient.infraNode.updateMany({
      where: {
        id: node.id,
        tenantId,
      },
      data: {
        metadata: toPrismaJson(nextMetadata),
      },
    });
  }
}

export async function regenerateRecommendationsForTenant(
  prismaClient: PrismaClient,
  tenantId: string,
): Promise<RecommendationRegenerationResult> {
  const nodes: NodeSnapshot[] = await prismaClient.infraNode.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      type: true,
      provider: true,
      region: true,
      availabilityZone: true,
      metadata: true,
    },
  });

  const coverage = computeCoverageCounters(nodes);
  const updatedAtIso = new Date().toISOString();
  const financialContext = await prismaClient.$transaction(async (transactionClient) => {
    await clearPersistedRecommendations(transactionClient, tenantId);
    const context = await buildLandingZoneFinancialContext(
      transactionClient as unknown as PrismaClient,
      tenantId,
    );
    await persistPendingRecommendationState(transactionClient, tenantId, context, updatedAtIso);
    return context;
  });

  return {
    totalNodes: nodes.length,
    recommendationsGenerated: financialContext.recommendations.length,
    resilientByDesign: coverage.resilientByDesign,
    noRuleApplicable: coverage.noRuleApplicable,
    requiresVerification: financialContext.recommendations.filter(
      (recommendation) => recommendation.requiresVerification,
    ).length,
    totalDrCostMonthly: financialContext.summary.totalCostMonthly,
    totalDrCostAnnual: financialContext.summary.totalCostAnnual,
    financialProfileConfigured: financialContext.summary.financialProfileConfigured,
  };
}
