import { appLogger } from "../utils/logger.js";
// ============================================================
// Landing Zone Resilience Routes — Recovery recommendations
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { generateBIA } from '../graph/biaEngine.js';
import { generateLandingZoneRecommendations } from '../graph/landingZoneService.js';
import {
  buildFinancialDisclaimers,
  calculateRecommendationRoi,
  estimateServiceMonthlyProductionCost,
  resolveCompanyFinancialProfile,
  resolveIncidentProbabilityForNodeType,
  selectDrStrategyForService,
  strategyKeyToLegacySlug,
  strategyTargetRpoMinutes,
  strategyTargetRtoMinutes,
} from '../services/company-financial-profile.service.js';

const router = Router();

type LandingZoneRecommendationStatus = 'pending' | 'validated' | 'rejected';

type RecommendationStatusHistoryEntry = {
  from: LandingZoneRecommendationStatus;
  to: LandingZoneRecommendationStatus;
  changedAt: string;
  notes: string | null;
};

type PersistedRecommendationState = {
  status: LandingZoneRecommendationStatus;
  notes: string | null;
  updatedAt: string | null;
  history: RecommendationStatusHistoryEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRecommendationStatus(value: unknown): LandingZoneRecommendationStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'pending' || normalized === 'validated' || normalized === 'rejected') {
    return normalized;
  }
  return null;
}

function acceptedFromStatus(status: LandingZoneRecommendationStatus): boolean | null {
  if (status === 'validated') return true;
  if (status === 'rejected') return false;
  return null;
}

function parsePersistedRecommendationState(metadata: unknown): PersistedRecommendationState {
  if (!isRecord(metadata)) {
    return { status: 'pending', notes: null, updatedAt: null, history: [] };
  }

  const persisted = isRecord(metadata.landingZoneRecommendation)
    ? metadata.landingZoneRecommendation
    : null;

  const statusFromBlock = normalizeRecommendationStatus(persisted?.status);
  const legacyAccepted = metadata.landingZoneAccepted;
  const statusFromLegacy =
    typeof legacyAccepted === 'boolean'
      ? legacyAccepted
        ? 'validated'
        : 'rejected'
      : 'pending';

  const status = statusFromBlock ?? statusFromLegacy;
  const notes = typeof persisted?.notes === 'string' ? persisted.notes : null;
  const updatedAt = typeof persisted?.updatedAt === 'string' ? persisted.updatedAt : null;
  const history = Array.isArray(persisted?.history)
    ? persisted.history.filter((entry): entry is RecommendationStatusHistoryEntry => {
        if (!isRecord(entry)) return false;
        return (
          normalizeRecommendationStatus(entry.from) !== null &&
          normalizeRecommendationStatus(entry.to) !== null &&
          typeof entry.changedAt === 'string'
        );
      }).map((entry) => ({
        from: normalizeRecommendationStatus(entry.from)!,
        to: normalizeRecommendationStatus(entry.to)!,
        changedAt: entry.changedAt,
        notes: typeof entry.notes === 'string' ? entry.notes : null,
      }))
    : [];

  return { status, notes, updatedAt, history };
}

function resolveNextStatus(override: Record<string, unknown>): LandingZoneRecommendationStatus {
  const explicitStatus = normalizeRecommendationStatus(override.status);
  if (explicitStatus) return explicitStatus;

  if (override.accepted === true) return 'validated';
  if (override.accepted === false) return 'rejected';
  return 'pending';
}

function normalizeCriticality(
  recoveryTier: number | null | undefined,
  criticalityScore: number | null | undefined,
  impactCategory: string | null | undefined,
): 'critical' | 'high' | 'medium' | 'low' {
  const impact = String(impactCategory || '').toLowerCase();
  if (impact.includes('tier1') || impact.includes('critical') || recoveryTier === 1) return 'critical';
  if (impact.includes('tier2') || impact.includes('high') || recoveryTier === 2) return 'high';
  if (impact.includes('tier3') || impact.includes('medium') || recoveryTier === 3) return 'medium';
  if (impact.includes('tier4') || recoveryTier === 4) return 'low';

  const score = Number(criticalityScore);
  if (Number.isFinite(score)) {
    const normalized = score > 1 ? score / 100 : score;
    if (normalized >= 0.85) return 'critical';
    if (normalized >= 0.65) return 'high';
    if (normalized >= 0.45) return 'medium';
  }
  return 'low';
}

function resolveStrategyOverride(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  const recommendationBlock = isRecord(metadata.landingZoneRecommendation)
    ? metadata.landingZoneRecommendation
    : null;
  if (typeof recommendationBlock?.strategyOverride === 'string') {
    return recommendationBlock.strategyOverride;
  }
  if (typeof metadata.recoveryStrategy === 'string') {
    return metadata.recoveryStrategy;
  }
  return null;
}

type BuiltRecommendation = {
  id: string;
  nodeId: string;
  serviceName: string;
  tier: number;
  strategy: string;
  estimatedCost: number;
  estimatedAnnualCost: number;
  estimatedProductionMonthlyCost: number;
  costSource: string;
  costConfidence: number;
  roi: number | null;
  roiStatus: string;
  roiMessage: string;
  paybackMonths: number | null;
  paybackLabel: string;
  accepted: boolean | null;
  status: LandingZoneRecommendationStatus;
  statusUpdatedAt: string | null;
  statusHistory: RecommendationStatusHistoryEntry[];
  description: string;
  priority: number;
  notes: string | null;
  budgetWarning: string | null;
  calculation: {
    aleCurrent: number;
    aleAfter: number;
    riskAvoidedAnnual: number;
    annualDrCost: number;
    formula: string;
    inputs: {
      hourlyDowntimeCost: number;
      currentRtoHours: number;
      targetRtoHours: number;
      incidentProbabilityAnnual: number;
      monthlyDrCost: number;
    };
  };
  sources: string[];
};

type BuiltRecommendationContext = {
  recommendations: BuiltRecommendation[];
  summary: {
    totalCostMonthly: number;
    totalCostAnnual: number;
    byStrategy: Record<string, number>;
    annualCostByStrategy: Record<string, number>;
    costSharePercentByStrategy: Record<string, number>;
    totalRecommendations: number;
    riskAvoidedAnnual: number;
    roiPercent: number | null;
    paybackMonths: number | null;
  };
  profile: Awaited<ReturnType<typeof resolveCompanyFinancialProfile>>;
  financialDisclaimers: ReturnType<typeof buildFinancialDisclaimers>;
};

async function buildLandingZoneRecommendationContext(
  tenantId: string,
): Promise<BuiltRecommendationContext> {
  const graph = await GraphService.getGraph(prisma, tenantId);
  if (graph.order === 0) {
    return {
      recommendations: [],
      summary: {
        totalCostMonthly: 0,
        totalCostAnnual: 0,
        byStrategy: {},
        annualCostByStrategy: {},
        costSharePercentByStrategy: {},
        totalRecommendations: 0,
        riskAvoidedAnnual: 0,
        roiPercent: null,
        paybackMonths: null,
      },
      profile: await resolveCompanyFinancialProfile(prisma, tenantId),
      financialDisclaimers: buildFinancialDisclaimers(),
    };
  }

  const [analysis, latestValidatedBia, profile] = await Promise.all([
    analyzeFullGraph(graph),
    prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        processes: {
          where: {
            validationStatus: 'validated',
          },
          select: {
            serviceNodeId: true,
            recoveryTier: true,
            impactCategory: true,
            criticalityScore: true,
            suggestedRTO: true,
            validatedRTO: true,
            suggestedRPO: true,
            validatedRPO: true,
          },
        },
      },
    }),
    resolveCompanyFinancialProfile(prisma, tenantId),
  ]);

  const bia = generateBIA(graph, analysis);
  const report = generateLandingZoneRecommendations(bia, analysis);
  const serviceIds = report.recommendations.map((rec) => rec.serviceId);
  const [nodeSnapshots] = await Promise.all([
    serviceIds.length
      ? prisma.infraNode.findMany({
          where: {
            tenantId,
            id: { in: serviceIds },
          },
          select: {
            id: true,
            type: true,
            provider: true,
            metadata: true,
            criticalityScore: true,
            impactCategory: true,
            suggestedRTO: true,
            validatedRTO: true,
            suggestedRPO: true,
            validatedRPO: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const recommendationStateByServiceId = new Map(
    nodeSnapshots.map((snapshot) => [snapshot.id, parsePersistedRecommendationState(snapshot.metadata)]),
  );
  const validatedBiaByServiceId = new Map(
    (latestValidatedBia?.processes || []).map((process) => [process.serviceNodeId, process]),
  );
  const nodeByServiceId = new Map(nodeSnapshots.map((node) => [node.id, node]));

  let budgetRemainingMonthly =
    profile.estimatedDrBudgetAnnual && profile.estimatedDrBudgetAnnual > 0
      ? profile.estimatedDrBudgetAnnual / 12
      : null;

  const sortedRecommendations = [...report.recommendations].sort(
    (left, right) => right.priorityScore - left.priorityScore,
  );

  const built: BuiltRecommendation[] = [];
  for (const recommendation of sortedRecommendations) {
    const node = nodeByServiceId.get(recommendation.serviceId);
    const validatedProcess = validatedBiaByServiceId.get(recommendation.serviceId);
    const state = recommendationStateByServiceId.get(recommendation.serviceId) ?? {
      status: 'pending',
      notes: null,
      updatedAt: null,
      history: [],
    };

    const monthlyCostEstimate = estimateServiceMonthlyProductionCost(
      {
        type: node?.type || 'APPLICATION',
        provider: node?.provider || 'unknown',
        metadata: node?.metadata || {},
        criticalityScore: node?.criticalityScore ?? validatedProcess?.criticalityScore ?? null,
        impactCategory: node?.impactCategory ?? validatedProcess?.impactCategory ?? null,
      },
      profile.currency,
    );

    const criticality = normalizeCriticality(
      validatedProcess?.recoveryTier ?? recommendation.recoveryTier,
      validatedProcess?.criticalityScore ?? node?.criticalityScore ?? null,
      validatedProcess?.impactCategory ?? node?.impactCategory ?? null,
    );

    const targetRtoMinutes =
      validatedProcess?.validatedRTO ??
      validatedProcess?.suggestedRTO ??
      node?.validatedRTO ??
      node?.suggestedRTO ??
      recommendation.strategy.targetRTO ??
      240;
    const targetRpoMinutes =
      validatedProcess?.validatedRPO ??
      validatedProcess?.suggestedRPO ??
      node?.validatedRPO ??
      node?.suggestedRPO ??
      recommendation.strategy.targetRPO ??
      60;

    const selected = selectDrStrategyForService({
      targetRtoMinutes,
      targetRpoMinutes,
      criticality,
      monthlyProductionCost: monthlyCostEstimate.estimatedMonthlyCost,
      budgetRemainingMonthly,
      overrideStrategy: resolveStrategyOverride(node?.metadata),
    });

    if (budgetRemainingMonthly && selected.monthlyDrCost > 0) {
      budgetRemainingMonthly = Math.max(0, budgetRemainingMonthly - selected.monthlyDrCost);
    }

    const currentRtoMinutes =
      validatedProcess?.validatedRTO ??
      validatedProcess?.suggestedRTO ??
      node?.validatedRTO ??
      node?.suggestedRTO ??
      240;
    const probability = resolveIncidentProbabilityForNodeType(node?.type || recommendation.serviceName);
    const roi = calculateRecommendationRoi({
      hourlyDowntimeCost: profile.hourlyDowntimeCost,
      currentRtoMinutes,
      targetRtoMinutes: strategyTargetRtoMinutes(selected.strategy),
      incidentProbabilityAnnual: probability.probabilityAnnual,
      monthlyDrCost: selected.monthlyDrCost,
    });

    built.push({
      id: recommendation.serviceId,
      nodeId: recommendation.serviceId,
      serviceName: recommendation.serviceName,
      tier: recommendation.recoveryTier,
      strategy: strategyKeyToLegacySlug(selected.strategy),
      estimatedCost: selected.monthlyDrCost,
      estimatedAnnualCost: selected.annualDrCost,
      estimatedProductionMonthlyCost: monthlyCostEstimate.estimatedMonthlyCost,
      costSource: monthlyCostEstimate.costSource,
      costConfidence: monthlyCostEstimate.confidence,
      roi: roi.roiPercent,
      roiStatus: roi.roiStatus,
      roiMessage: roi.roiMessage,
      paybackMonths: roi.paybackMonths,
      paybackLabel: roi.paybackLabel,
      accepted: acceptedFromStatus(state.status),
      status: state.status,
      statusUpdatedAt: state.updatedAt,
      statusHistory: state.history,
      description: recommendation.strategy.description,
      priority: recommendation.priorityScore,
      notes: state.notes,
      budgetWarning: selected.budgetWarning,
      calculation: {
        aleCurrent: roi.aleCurrent,
        aleAfter: roi.aleAfter,
        riskAvoidedAnnual: roi.riskAvoidedAnnual,
        annualDrCost: roi.annualDrCost,
        formula: roi.formula,
        inputs: roi.inputs,
      },
      sources: [
        monthlyCostEstimate.sourceReference,
        probability.source,
      ],
    });
  }

  await Promise.all(
    built.map((entry) =>
      prisma.infraNode.updateMany({
        where: { id: entry.id, tenantId },
        data: {
          estimatedMonthlyCost: entry.estimatedProductionMonthlyCost,
          estimatedMonthlyCostCurrency: profile.currency,
          estimatedMonthlyCostSource: entry.costSource,
          estimatedMonthlyCostConfidence: entry.costConfidence,
          estimatedMonthlyCostUpdatedAt: new Date(),
        },
      }),
    ),
  );

  const byStrategy: Record<string, number> = {};
  const annualCostByStrategy: Record<string, number> = {};
  let totalCostMonthly = 0;
  let totalCostAnnual = 0;
  let totalRiskAvoidedAnnual = 0;

  for (const recommendation of built) {
    byStrategy[recommendation.strategy] = (byStrategy[recommendation.strategy] || 0) + 1;
    annualCostByStrategy[recommendation.strategy] =
      (annualCostByStrategy[recommendation.strategy] || 0) + recommendation.estimatedAnnualCost;
    totalCostMonthly += recommendation.estimatedCost;
    totalCostAnnual += recommendation.estimatedAnnualCost;
    totalRiskAvoidedAnnual += recommendation.calculation.riskAvoidedAnnual;
  }

  const costSharePercentByStrategy = Object.fromEntries(
    Object.entries(annualCostByStrategy).map(([strategy, annualCost]) => [
      strategy,
      totalCostAnnual > 0 ? Math.round((annualCost / totalCostAnnual) * 10_000) / 100 : 0,
    ]),
  );

  const roiPercent =
    totalCostAnnual > 0 && totalRiskAvoidedAnnual > 0
      ? Math.round(((totalRiskAvoidedAnnual - totalCostAnnual) / totalCostAnnual) * 10_000) / 100
      : null;
  const paybackMonths =
    totalRiskAvoidedAnnual > 0 && totalCostAnnual > 0
      ? Math.round((totalCostAnnual / (totalRiskAvoidedAnnual / 12)) * 100) / 100
      : null;

  return {
    recommendations: built,
    summary: {
      totalCostMonthly: Math.round(totalCostMonthly * 100) / 100,
      totalCostAnnual: Math.round(totalCostAnnual * 100) / 100,
      byStrategy,
      annualCostByStrategy,
      costSharePercentByStrategy,
      totalRecommendations: built.length,
      riskAvoidedAnnual: Math.round(totalRiskAvoidedAnnual * 100) / 100,
      roiPercent,
      paybackMonths,
    },
    profile,
    financialDisclaimers: buildFinancialDisclaimers(),
  };
}

// ─── GET /recommendations/landing-zone — Generate landing zone recommendations ──────────
router.get('/', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    const graph = await GraphService.getGraph(prisma, tenantId);
    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    const context = await buildLandingZoneRecommendationContext(tenantId);
    return res.json(context.recommendations);
  } catch (error) {
    appLogger.error('Error generating landing zone recommendations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /recommendations/landing-zone — Accept/reject recommendations ──────────
router.patch('/', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const rawOverrides = req.body?.overrides;
    if (!Array.isArray(rawOverrides)) {
      return res.status(400).json({ error: 'overrides array is required' });
    }
    const overrides = rawOverrides
      .filter((override) => isRecord(override) && typeof override.serviceId === 'string')
      .map((override) => ({
        serviceId: String(override.serviceId),
        status: override.status,
        accepted: override.accepted,
        notes: override.notes,
      }));

    if (overrides.length === 0) {
      return res.status(400).json({ error: 'at least one valid override is required' });
    }

    // Generate current recommendations
    const recommendationContext = await buildLandingZoneRecommendationContext(tenantId);
    const recommendationByServiceId = new Map(
      recommendationContext.recommendations.map((recommendation) => [recommendation.id, recommendation]),
    );

    const targetServiceIds = Array.from(new Set(overrides.map((override) => override.serviceId)));
    const nodeSnapshots = await prisma.infraNode.findMany({
      where: {
        tenantId,
        id: { in: targetServiceIds },
      },
      select: {
        id: true,
        metadata: true,
      },
    });
    const nodeById = new Map(nodeSnapshots.map((node) => [node.id, node]));

    let updated = 0;
    let validated = 0;
    let rejected = 0;
    let pending = 0;

    for (const override of overrides) {
      const recommendation = recommendationByServiceId.get(override.serviceId);
      if (!recommendation) continue;

      const node = nodeById.get(override.serviceId);
      const currentMetadata = isRecord(node?.metadata) ? { ...node.metadata } : {};
      const currentState = parsePersistedRecommendationState(currentMetadata);
      const nextStatus = resolveNextStatus(override);
      const notes =
        override.notes === undefined
          ? currentState.notes
          : override.notes === null
            ? null
            : String(override.notes);
      const changed = nextStatus !== currentState.status || notes !== currentState.notes;
      const changedAt = new Date().toISOString();

      const history = changed
        ? [
            ...currentState.history,
            {
              from: currentState.status,
              to: nextStatus,
              changedAt,
              notes,
            },
          ]
        : currentState.history;

      const nextMetadata: Record<string, unknown> = {
        ...currentMetadata,
        landingZoneAccepted: acceptedFromStatus(nextStatus),
        landingZoneRecommendation: {
          status: nextStatus,
          notes,
          updatedAt: changed ? changedAt : currentState.updatedAt ?? changedAt,
          history,
        },
      };

      if (nextStatus === 'validated' && recommendation.strategy) {
        nextMetadata.recoveryStrategy = recommendation.strategy;
      }

      const updateResult = await prisma.infraNode.updateMany({
        where: { id: override.serviceId, tenantId },
        data: {
          metadata: JSON.parse(JSON.stringify(nextMetadata)),
        },
      });

      if (updateResult.count > 0) {
        updated += updateResult.count;
        if (nextStatus === 'validated') validated += 1;
        if (nextStatus === 'rejected') rejected += 1;
        if (nextStatus === 'pending') pending += 1;
      }

      if (changed) {
        appLogger.info('landing_zone.recommendation_status_changed', {
          tenantId,
          serviceId: override.serviceId,
          from: currentState.status,
          to: nextStatus,
          changedAt,
        });
      }
    }

    return res.json({
      updated,
      validated,
      rejected,
      pending,
    });
  } catch (error) {
    appLogger.error('Error updating landing zone recommendations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /recommendations/landing-zone/cost-summary — Cost breakdown ──────────
router.get('/cost-summary', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);
    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    const context = await buildLandingZoneRecommendationContext(tenantId);
    return res.json({
      totalCost: context.summary.totalCostMonthly,
      totalAnnualCost: context.summary.totalCostAnnual,
      byStrategy: context.summary.byStrategy,
      annualCostByStrategy: context.summary.annualCostByStrategy,
      costSharePercentByStrategy: context.summary.costSharePercentByStrategy,
      totalRecommendations: context.summary.totalRecommendations,
      riskAvoidedAnnual: context.summary.riskAvoidedAnnual,
      roiPercent: context.summary.roiPercent,
      paybackMonths: context.summary.paybackMonths,
      currency: context.profile.currency,
      budgetAnnual: context.profile.estimatedDrBudgetAnnual,
      financialDisclaimers: context.financialDisclaimers,
    });
  } catch (error) {
    appLogger.error('Error generating cost summary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
