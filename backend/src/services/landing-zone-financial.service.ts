import type { PrismaClient } from '@prisma/client';
import { appLogger } from '../utils/logger.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { generateBIA } from '../graph/biaEngine.js';
import { generateLandingZoneRecommendations } from '../graph/landingZoneService.js';
import { BusinessFlowFinancialEngineService } from './business-flow-financial-engine.service.js';
import {
  FinancialEngineService,
  type AnalysisResultInput,
  type BIAResultInput,
  type FinancialOrganizationProfileInput,
  type NodeFinancialOverrideInput,
  type RecommendationInput,
  type ResolvedNodeFinancialCostInput,
} from './financial-engine.service.js';
import {
  buildFinancialDisclaimers,
  estimateStrategyMonthlyDrCost,
  estimateServiceMonthlyProductionCost,
  findNextImprovingStrategy,
  resolveCompanyFinancialProfile,
  resolveIncidentProbabilityForNodeType,
  selectDrStrategyForService,
  strategyKeyToLegacySlug,
  strategyTargetRpoMinutes,
  strategyTargetRtoMinutes,
} from './company-financial-profile.service.js';

export type LandingZoneRecommendationStatus = 'pending' | 'validated' | 'rejected';

export type RecommendationStatusHistoryEntry = {
  from: LandingZoneRecommendationStatus;
  to: LandingZoneRecommendationStatus;
  changedAt: string;
  notes: string | null;
};

export type PersistedRecommendationState = {
  status: LandingZoneRecommendationStatus;
  notes: string | null;
  updatedAt: string | null;
  history: RecommendationStatusHistoryEntry[];
};

export type LandingZoneFinancialRecommendation = {
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

export type LandingZoneFinancialSummary = {
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

export type LandingZoneFinancialContext = {
  recommendations: LandingZoneFinancialRecommendation[];
  summary: LandingZoneFinancialSummary;
  recommendationInputs: RecommendationInput[];
  roi: ReturnType<typeof FinancialEngineService.calculateROI>;
  ale: ReturnType<typeof FinancialEngineService.calculateAnnualExpectedLoss>;
  profile: Awaited<ReturnType<typeof resolveCompanyFinancialProfile>>;
  financialProfileInput: FinancialOrganizationProfileInput;
  financialDisclaimers: ReturnType<typeof buildFinancialDisclaimers>;
  validationScope: {
    biaValidatedIncluded: number;
    biaExcludedPending: number;
  };
};

type InternalRecommendationSeed = {
  id: string;
  nodeId: string;
  serviceName: string;
  tier: number;
  strategyKey:
    | 'backup_restore'
    | 'pilot_light'
    | 'warm_standby'
    | 'hot_standby'
    | 'active_active';
  strategy: string;
  estimatedCost: number;
  estimatedAnnualCost: number;
  estimatedProductionMonthlyCost: number;
  costSource: string;
  costConfidence: number;
  description: string;
  priority: number;
  notes: string | null;
  status: LandingZoneRecommendationStatus;
  statusUpdatedAt: string | null;
  statusHistory: RecommendationStatusHistoryEntry[];
  budgetWarning: string | null;
  accepted: boolean | null;
  probabilitySource: string;
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

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

export function acceptedFromStatus(status: LandingZoneRecommendationStatus): boolean | null {
  if (status === 'validated') return true;
  if (status === 'rejected') return false;
  return null;
}

export function parsePersistedRecommendationState(metadata: unknown): PersistedRecommendationState {
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
    ? persisted.history
        .filter((entry): entry is RecommendationStatusHistoryEntry => {
          if (!isRecord(entry)) return false;
          return (
            normalizeRecommendationStatus(entry.from) !== null &&
            normalizeRecommendationStatus(entry.to) !== null &&
            typeof entry.changedAt === 'string'
          );
        })
        .map((entry) => ({
          from: normalizeRecommendationStatus(entry.from)!,
          to: normalizeRecommendationStatus(entry.to)!,
          changedAt: entry.changedAt,
          notes: typeof entry.notes === 'string' ? entry.notes : null,
        }))
    : [];

  return { status, notes, updatedAt, history };
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

function toFinancialProfileInput(
  profile: Awaited<ReturnType<typeof resolveCompanyFinancialProfile>>,
): FinancialOrganizationProfileInput {
  return {
    sizeCategory: profile.sizeCategory,
    verticalSector: profile.verticalSector,
    customDowntimeCostPerHour: profile.customDowntimeCostPerHour,
    hourlyDowntimeCost: profile.hourlyDowntimeCost,
    annualITBudget: profile.annualITBudget,
    drBudgetPercent: profile.drBudgetPercent,
    customCurrency: profile.currency,
    strongholdPlanId: profile.strongholdPlanId,
    strongholdMonthlyCost: profile.strongholdMonthlyCost,
  };
}

async function loadFinancialContext(prismaClient: PrismaClient, tenantId: string) {
  const [nodes, latestBia, overrides] = await Promise.all([
    prismaClient.infraNode.findMany({
      where: { tenantId },
      include: {
        inEdges: true,
        outEdges: true,
      },
      orderBy: { criticalityScore: 'desc' },
    }),
    prismaClient.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        processes: true,
      },
    }),
    prismaClient.nodeFinancialOverride.findMany({ where: { tenantId } }),
  ]);

  const analysisResult: AnalysisResultInput = {
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      provider: node.provider,
      region: node.region,
      isSPOF: node.isSPOF,
      criticalityScore: node.criticalityScore,
      redundancyScore: node.redundancyScore,
      impactCategory: node.impactCategory,
      suggestedRTO: node.suggestedRTO,
      validatedRTO: node.validatedRTO,
      suggestedRPO: node.suggestedRPO,
      validatedRPO: node.validatedRPO,
      suggestedMTPD: node.suggestedMTPD,
      validatedMTPD: node.validatedMTPD,
      dependentsCount: node.inEdges.length,
      inEdges: node.inEdges,
      outEdges: node.outEdges,
    })),
  };

  const latestBiaProcesses = latestBia?.processes ?? [];
  const validatedBiaProcesses = latestBiaProcesses.filter(
    (process) => process.validationStatus === 'validated',
  );

  const biaResult: BIAResultInput = {
    processes:
      validatedBiaProcesses.map((process) => ({
        serviceNodeId: process.serviceNodeId,
        recoveryTier: process.recoveryTier,
        suggestedRTO: process.suggestedRTO,
        validatedRTO: process.validatedRTO,
        suggestedRPO: process.suggestedRPO,
        validatedRPO: process.validatedRPO,
        suggestedMTPD: process.suggestedMTPD,
        validatedMTPD: process.validatedMTPD,
      })) || [],
  };

  const overridesByNodeId = Object.fromEntries(
    overrides.map((entry) => [entry.nodeId, { customCostPerHour: entry.customCostPerHour }]),
  ) as Record<string, NodeFinancialOverrideInput | undefined>;

  return {
    analysisResult,
    biaResult,
    overridesByNodeId,
    validationScope: {
      biaValidatedIncluded: validatedBiaProcesses.length,
      biaExcludedPending: Math.max(0, latestBiaProcesses.length - validatedBiaProcesses.length),
    },
  };
}

async function resolveNodeCostsFromBusinessFlows(
  prismaClient: PrismaClient,
  tenantId: string,
  analysisResult: AnalysisResultInput,
  profile: FinancialOrganizationProfileInput,
  overridesByNodeId: Record<string, NodeFinancialOverrideInput | undefined>,
): Promise<Record<string, ResolvedNodeFinancialCostInput>> {
  const businessFlowCount = await prismaClient.businessFlow.count({ where: { tenantId } });
  if (businessFlowCount === 0) {
    return {};
  }

  const flowEngine = new BusinessFlowFinancialEngineService(prismaClient);
  const entries = await Promise.all(
    analysisResult.nodes.map(async (node) => {
      const override = overridesByNodeId[node.id] ?? null;
      const flowCost = await flowEngine.calculateNodeCostFromFlows({
        tenantId,
        nodeId: node.id,
        node,
        orgProfile: profile,
        ...(override ? { override } : {}),
        includeUnvalidatedFlows: true,
        applyCloudCostFactor: true,
      });

      return [
        node.id,
        {
          costPerHour: flowCost.totalCostPerHour,
          method: flowCost.method,
          confidence: flowCost.confidence,
          fallbackEstimate: flowCost.fallbackEstimate,
          sources:
            flowCost.method === 'business_flows'
              ? ['Business flow financial model']
              : flowCost.method === 'user_override'
                ? ['User financial override']
                : ['Legacy financial fallback estimate'],
        } satisfies ResolvedNodeFinancialCostInput,
      ] as const;
    }),
  );

  return Object.fromEntries(entries);
}

function buildDefaultContext(
  profile: Awaited<ReturnType<typeof resolveCompanyFinancialProfile>>,
): LandingZoneFinancialContext {
  const financialProfileInput = toFinancialProfileInput(profile);
  const emptyAle = FinancialEngineService.calculateAnnualExpectedLoss(
    { nodes: [] },
    { processes: [] },
    financialProfileInput,
  );
  const emptyRoi = FinancialEngineService.calculateROI(
    { nodes: [] },
    { processes: [] },
    [],
    financialProfileInput,
  );

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
    recommendationInputs: [],
    roi: emptyRoi,
    ale: emptyAle,
    profile,
    financialProfileInput,
    financialDisclaimers: buildFinancialDisclaimers(),
    validationScope: {
      biaValidatedIncluded: 0,
      biaExcludedPending: 0,
    },
  };
}

export async function buildLandingZoneFinancialContext(
  prismaClient: PrismaClient,
  tenantId: string,
  options?: {
    preferredCurrency?: unknown;
  },
): Promise<LandingZoneFinancialContext> {
  const profile = await resolveCompanyFinancialProfile(prismaClient, tenantId, {
    preferredCurrency: options?.preferredCurrency,
  });
  const graph = await GraphService.getGraph(prismaClient, tenantId);
  if (graph.order === 0) {
    return buildDefaultContext(profile);
  }

  const analysis = await analyzeFullGraph(graph);
  const bia = generateBIA(graph, analysis);
  const report = generateLandingZoneRecommendations(bia, analysis);
  const serviceIds = report.recommendations.map((item) => item.serviceId);

  const [latestValidatedBia, nodeSnapshots, financialContext] = await Promise.all([
    prismaClient.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        processes: {
          where: { validationStatus: 'validated' },
          select: {
            serviceNodeId: true,
            recoveryTier: true,
            impactCategory: true,
            criticalityScore: true,
            validatedRTO: true,
            validatedRPO: true,
          },
        },
      },
    }),
    serviceIds.length
      ? prismaClient.infraNode.findMany({
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
            validatedRTO: true,
            suggestedRTO: true,
            validatedRPO: true,
            suggestedRPO: true,
          },
        })
      : Promise.resolve([]),
    loadFinancialContext(prismaClient, tenantId),
  ]);

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

  const recommendationSeeds: InternalRecommendationSeed[] = [];
  for (const recommendation of sortedRecommendations) {
    const node = nodeByServiceId.get(recommendation.serviceId);
    const validatedProcess = validatedBiaByServiceId.get(recommendation.serviceId);
    const state = parsePersistedRecommendationState(node?.metadata);

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
      validatedProcess?.validatedRTO ?? node?.validatedRTO ?? node?.suggestedRTO ?? null;
    const targetRpoMinutes =
      validatedProcess?.validatedRPO ?? node?.validatedRPO ?? node?.suggestedRPO ?? null;
    const currentRtoMinutes =
      validatedProcess?.validatedRTO ?? node?.validatedRTO ?? node?.suggestedRTO ?? null;

    const selected = selectDrStrategyForService({
      targetRtoMinutes,
      targetRpoMinutes,
      criticality,
      monthlyProductionCost: monthlyCostEstimate.estimatedMonthlyCost,
      budgetRemainingMonthly,
      overrideStrategy: resolveStrategyOverride(node?.metadata),
    });
    const adjustedStrategy = findNextImprovingStrategy(selected.strategy, currentRtoMinutes);
    if (!adjustedStrategy) {
      appLogger.warn('landing_zone.recommendation_skipped_no_rto_gain', {
        tenantId,
        serviceId: recommendation.serviceId,
        serviceName: recommendation.serviceName,
        strategy: selected.strategy,
        currentRtoMinutes,
      });
      continue;
    }

    const strategyUpgraded = adjustedStrategy !== selected.strategy;
    const monthlyDrCost = strategyUpgraded
      ? estimateStrategyMonthlyDrCost(monthlyCostEstimate.estimatedMonthlyCost, adjustedStrategy)
      : selected.monthlyDrCost;
    const annualDrCost = roundMoney(monthlyDrCost * 12);
    const budgetWarning = strategyUpgraded
      ? selected.budgetWarning
        ? `${selected.budgetWarning} | Ajustement RTO: strategie relevee pour garantir un gain de reprise.`
        : 'Ajustement RTO: strategie relevee pour garantir un gain de reprise.'
      : selected.budgetWarning;

    if (budgetRemainingMonthly && monthlyDrCost > 0) {
      budgetRemainingMonthly = Math.max(0, budgetRemainingMonthly - monthlyDrCost);
    }

    const strategy = strategyKeyToLegacySlug(adjustedStrategy);
    const probability = resolveIncidentProbabilityForNodeType(node?.type || recommendation.serviceName);

    recommendationSeeds.push({
      id: recommendation.serviceId,
      nodeId: recommendation.serviceId,
      serviceName: recommendation.serviceName,
      tier: recommendation.recoveryTier,
      strategyKey: adjustedStrategy,
      strategy,
      estimatedCost: monthlyDrCost,
      estimatedAnnualCost: annualDrCost,
      estimatedProductionMonthlyCost: monthlyCostEstimate.estimatedMonthlyCost,
      costSource: monthlyCostEstimate.costSource,
      costConfidence: monthlyCostEstimate.confidence,
      description: recommendation.strategy.description,
      priority: recommendation.priorityScore,
      notes: state.notes,
      status: state.status,
      statusUpdatedAt: state.updatedAt,
      statusHistory: state.history,
      budgetWarning,
      accepted: acceptedFromStatus(state.status),
      probabilitySource: probability.source,
    });
  }

  await Promise.all(
    recommendationSeeds.map((entry) =>
      prismaClient.infraNode.updateMany({
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

  const recommendationInputs: RecommendationInput[] = recommendationSeeds.map((entry) => ({
    recommendationId: entry.id,
    id: entry.id,
    strategy: entry.strategy,
    targetNodes: [entry.nodeId],
    monthlyCost: entry.estimatedCost,
    annualCost: entry.estimatedAnnualCost,
    targetRtoMinutes: strategyTargetRtoMinutes(entry.strategyKey),
    targetRpoMinutes: strategyTargetRpoMinutes(entry.strategyKey),
  }));

  const financialProfileInput = toFinancialProfileInput(profile);
  const resolvedNodeCosts = await resolveNodeCostsFromBusinessFlows(
    prismaClient,
    tenantId,
    financialContext.analysisResult,
    financialProfileInput,
    financialContext.overridesByNodeId,
  );

  const ale = FinancialEngineService.calculateAnnualExpectedLoss(
    financialContext.analysisResult,
    financialContext.biaResult,
    financialProfileInput,
    financialContext.overridesByNodeId,
    resolvedNodeCosts,
  );

  const roi = FinancialEngineService.calculateROI(
    financialContext.analysisResult,
    financialContext.biaResult,
    recommendationInputs,
    financialProfileInput,
    financialContext.overridesByNodeId,
    resolvedNodeCosts,
  );

  const breakdownByRecommendationId = new Map(
    roi.breakdownByRecommendation.map((entry) => [entry.recommendationId, entry]),
  );

  const recommendations: LandingZoneFinancialRecommendation[] = recommendationSeeds.flatMap((seed) => {
    const breakdown = breakdownByRecommendationId.get(seed.id);
    if (!breakdown) {
      appLogger.warn('landing_zone.recommendation_filtered_missing_breakdown', {
        tenantId,
        serviceId: seed.id,
        serviceName: seed.serviceName,
      });
      return [];
    }
    if (breakdown.projectedALE >= breakdown.currentALE || breakdown.riskReduction <= 0) {
      appLogger.warn('landing_zone.recommendation_filtered_non_positive_gain', {
        tenantId,
        serviceId: seed.id,
        serviceName: seed.serviceName,
        aleBefore: breakdown.currentALE,
        aleAfter: breakdown.projectedALE,
        riskReduction: breakdown.riskReduction,
      });
      return [];
    }
    const fallbackRto = strategyTargetRtoMinutes(seed.strategyKey) / 60;
    const fallbackInputs = {
      hourlyDowntimeCost: roundMoney(profile.hourlyDowntimeCost),
      currentRtoHours: fallbackRto,
      targetRtoHours: fallbackRto,
      incidentProbabilityAnnual: 0,
      monthlyDrCost: roundMoney(seed.estimatedCost),
    };
    const calculationInputs = breakdown?.calculationInputs ?? fallbackInputs;
    const annualDrCost = breakdown.annualCost ?? seed.estimatedAnnualCost;
    const riskAvoidedAnnual = breakdown.riskReduction ?? 0;
    const aleCurrent = breakdown.currentALE ?? 0;
    const aleAfter = breakdown.projectedALE ?? Math.max(0, aleCurrent - riskAvoidedAnnual);

    return [{
      id: seed.id,
      nodeId: seed.nodeId,
      serviceName: seed.serviceName,
      tier: seed.tier,
      strategy: seed.strategy,
      estimatedCost: seed.estimatedCost,
      estimatedAnnualCost: seed.estimatedAnnualCost,
      estimatedProductionMonthlyCost: seed.estimatedProductionMonthlyCost,
      costSource: seed.costSource,
      costConfidence: seed.costConfidence,
      roi: breakdown?.individualROI ?? null,
      roiStatus: breakdown?.roiStatus ?? 'non_applicable',
      roiMessage: breakdown?.roiMessage ?? 'Non applicable',
      paybackMonths: breakdown?.paybackMonths ?? null,
      paybackLabel: breakdown?.paybackLabel ?? 'Non rentable',
      accepted: seed.accepted,
      status: seed.status,
      statusUpdatedAt: seed.statusUpdatedAt,
      statusHistory: seed.statusHistory,
      description: seed.description,
      priority: seed.priority,
      notes: seed.notes,
      budgetWarning: seed.budgetWarning,
      calculation: {
        aleCurrent: roundMoney(aleCurrent),
        aleAfter: roundMoney(aleAfter),
        riskAvoidedAnnual: roundMoney(riskAvoidedAnnual),
        annualDrCost: roundMoney(annualDrCost),
        formula:
          breakdown?.formula ??
          'ALE = hourlyDowntimeCost x RTO(hours) x annualIncidentProbability; ROI = ((riskAvoided - annualDrCost) / annualDrCost) x 100',
        inputs: calculationInputs,
      },
      sources: [
        seed.probabilitySource,
        'Stronghold financial engine',
      ],
    }];
  });

  const recommendationInputById = new Map<string, RecommendationInput>(
    recommendationInputs
      .map((entry) => [String(entry.recommendationId || entry.id || ''), entry] as const)
      .filter((entry) => entry[0].length > 0),
  );
  const filteredRecommendationInputs = recommendations
    .map((recommendation) => recommendationInputById.get(recommendation.id))
    .filter((entry): entry is RecommendationInput => Boolean(entry));

  const byStrategy: Record<string, number> = {};
  const annualCostByStrategy: Record<string, number> = {};
  for (const recommendation of recommendations) {
    byStrategy[recommendation.strategy] = (byStrategy[recommendation.strategy] || 0) + 1;
    annualCostByStrategy[recommendation.strategy] =
      (annualCostByStrategy[recommendation.strategy] || 0) + recommendation.estimatedAnnualCost;
  }

  const totalCostAnnual = roi.annualRemediationCost;
  const totalCostMonthly = roundMoney(totalCostAnnual / 12);
  const costSharePercentByStrategy = Object.fromEntries(
    Object.entries(annualCostByStrategy).map(([strategy, annualCost]) => [
      strategy,
      totalCostAnnual > 0 ? roundMoney((annualCost / totalCostAnnual) * 100) : 0,
    ]),
  );

  return {
    recommendations,
    summary: {
      totalCostMonthly,
      totalCostAnnual,
      byStrategy,
      annualCostByStrategy: Object.fromEntries(
        Object.entries(annualCostByStrategy).map(([strategy, annualCost]) => [
          strategy,
          roundMoney(annualCost),
        ]),
      ),
      costSharePercentByStrategy,
      totalRecommendations: recommendations.length,
      riskAvoidedAnnual: roi.riskReductionAmount,
      roiPercent: roi.roiPercent,
      paybackMonths: roi.paybackMonths,
    },
    recommendationInputs: filteredRecommendationInputs,
    roi,
    ale,
    profile,
    financialProfileInput,
    financialDisclaimers: buildFinancialDisclaimers(),
    validationScope: financialContext.validationScope,
  };
}
