import type { PrismaClient } from '@prisma/client';
import { appLogger } from '../utils/logger.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { generateBIA } from '../graph/biaEngine.js';
import { generateLandingZoneRecommendations } from '../graph/landingZoneService.js';
import { calculateBlastRadius } from '../graph/blastRadiusEngine.js';
import type { InfraNodeAttrs } from '../graph/types.js';
import { BusinessFlowFinancialEngineService } from './business-flow-financial-engine.service.js';
import { calculateServiceDowntimeCosts } from './pricing/downtimeDistribution.js';
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
  buildServiceSpecificRecommendation,
  buildFinancialDisclaimers,
  estimateStrategyMonthlyDrCost,
  estimateServiceMonthlyProductionCostAsync,
  findNextImprovingStrategy,
  resolveCompanyFinancialProfile,
  resolveIncidentProbabilityForNodeType,
  selectDrStrategyForService,
  strategyKeyToLegacySlug,
  strategyTargetRpoMinutes,
  strategyTargetRtoMinutes,
} from './company-financial-profile.service.js';
import {
  normalizeStrategyCostPercentages,
  partitionRecommendationsByAleCap,
} from './landing-zone-cost-optimization.js';
import { resolveServiceIdentity } from './service-identity.service.js';
import {
  buildRecommendationRuleNode,
  isNodeResilientByDesign as isNodeResilientByDesignRule,
} from './dr-recommendation-engine/rules/index.js';

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
  serviceDisplayName: string;
  serviceTechnicalName: string;
  tier: number;
  groupKey: string | null;
  allocationShare: number;
  recommendationBand: 'primary' | 'secondary';
  costCountedInSummary: boolean;
  strategy: string;
  estimatedCost: number;
  estimatedAnnualCost: number;
  estimatedProductionMonthlyCost: number;
  costSource: string;
  costSourceLabel: string;
  costConfidence: number;
  roiReliable: boolean;
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
  requiresVerification: boolean;
  withinBudgetCap: boolean;
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
  downtimeCostPerHour: number;
  downtimeCostSource: 'blast_radius' | 'override' | 'not_configured' | 'fallback_criticality';
  downtimeCostSourceLabel: string;
  downtimeCostRationale: string;
  blastRadius?: {
    directDependents: number;
    transitiveDependents: number;
    totalServices: number;
    impactedServices: string[];
  };
};

export type LandingZoneFinancialSummary = {
  totalCostMonthly: number;
  totalCostAnnual: number;
  byStrategy: Record<string, number>;
  annualCostByStrategy: Record<string, number>;
  costSharePercentByStrategy: Record<string, number>;
  totalRecommendations: number;
  secondaryRecommendations: number;
  secondaryAnnualCost: number;
  annualCostCap: number;
  budgetAnnual: number | null;
  selectedAnnualCost: number;
  remainingBudgetAnnual: number | null;
  riskAvoidedAnnual: number;
  roiPercent: number | null;
  paybackMonths: number | null;
  paybackLabel: string;
  financialProfileConfigured: boolean;
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
  serviceDisplayName: string;
  serviceTechnicalName: string;
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
  costSourceLabel: string;
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
  criticality: 'critical' | 'high' | 'medium' | 'low';
  nodeType: string;
  provider: string;
  metadata: Record<string, unknown>;
  groupKey: string | null;
  allocationShare: number;
  recommendationBand: 'primary' | 'secondary';
  costCountedInSummary: boolean;
  requiresVerification: boolean;
};

type FinancialProfileForRoiVisibility = {
  hourlyDowntimeCost: number | null;
  customDowntimeCostPerHour: number | null;
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFinancialProfileConfigured(
  profile: FinancialProfileForRoiVisibility | null | undefined,
): boolean {
  const hourlyDowntimeCost = Number(profile?.hourlyDowntimeCost ?? 0);
  if (Number.isFinite(hourlyDowntimeCost) && hourlyDowntimeCost > 0) {
    return true;
  }
  const legacyHourlyCost = Number(profile?.customDowntimeCostPerHour ?? 0);
  return Number.isFinite(legacyHourlyCost) && legacyHourlyCost > 0;
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

function isServiceResilientByDesign(input: {
  nodeType: string;
  provider: string | null | undefined;
  metadata: Record<string, unknown>;
}): boolean {
  const ruleNode = buildRecommendationRuleNode({
    id: 'landing-zone-check',
    name: 'landing-zone-check',
    nodeType: input.nodeType,
    provider: input.provider ?? null,
    metadata: input.metadata,
  });
  return isNodeResilientByDesignRule(ruleNode);
}

function normalizeDisplayKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toFinancialProfileInput(
  profile: Awaited<ReturnType<typeof resolveCompanyFinancialProfile>>,
): FinancialOrganizationProfileInput {
  return {
    mode: profile.mode,
    sizeCategory: profile.sizeCategory,
    verticalSector: profile.verticalSector,
    industrySector: profile.industrySector,
    employeeCount: profile.employeeCount,
    annualRevenue: profile.annualRevenue,
    customDowntimeCostPerHour: profile.customDowntimeCostPerHour,
    hourlyDowntimeCost: profile.hourlyDowntimeCost,
    annualITBudget: profile.annualITBudget,
    drBudgetPercent: profile.drBudgetPercent,
    customCurrency: profile.currency,
    strongholdPlanId: profile.strongholdPlanId,
    strongholdMonthlyCost: profile.strongholdMonthlyCost,
    numberOfCustomers: profile.numberOfCustomers,
    criticalBusinessHours: profile.criticalBusinessHours,
    regulatoryConstraints: profile.regulatoryConstraints,
    serviceOverrides: profile.serviceOverrides,
    isConfigured: profile.isConfigured,
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
      metadata: node.metadata,
      estimatedMonthlyCost: node.estimatedMonthlyCost,
      estimatedMonthlyCostCurrency: node.estimatedMonthlyCostCurrency,
      estimatedMonthlyCostSource: node.estimatedMonthlyCostSource,
      estimatedMonthlyCostConfidence: node.estimatedMonthlyCostConfidence,
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
  financialProfileConfigured: boolean,
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
      secondaryRecommendations: 0,
      secondaryAnnualCost: 0,
      annualCostCap: 0,
      budgetAnnual: profile.estimatedDrBudgetAnnual ?? null,
      selectedAnnualCost: 0,
      remainingBudgetAnnual: profile.estimatedDrBudgetAnnual ?? null,
      riskAvoidedAnnual: 0,
      roiPercent: null,
      paybackMonths: null,
      paybackLabel: 'Non rentable',
      financialProfileConfigured,
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
  const [profile, financialProfile, graph] = await Promise.all([
    resolveCompanyFinancialProfile(prismaClient, tenantId, {
      preferredCurrency: options?.preferredCurrency,
    }),
    prismaClient.organizationProfile.findUnique({
      where: { tenantId },
      select: {
        hourlyDowntimeCost: true,
        customDowntimeCostPerHour: true,
      },
    }),
    GraphService.getGraph(prismaClient, tenantId),
  ]);
  const financialProfileConfigured = isFinancialProfileConfigured(financialProfile);
  if (graph.order === 0) {
    return buildDefaultContext(profile, financialProfileConfigured);
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
            name: true,
            businessName: true,
            type: true,
            provider: true,
            metadata: true,
            estimatedMonthlyCost: true,
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
  const configuredBudgetAnnual =
    profile.estimatedDrBudgetAnnual && profile.estimatedDrBudgetAnnual > 0
      ? roundMoney(profile.estimatedDrBudgetAnnual)
      : null;

  const sortedRecommendations = [...report.recommendations].sort(
    (left, right) => right.priorityScore - left.priorityScore,
  );

  const recommendationSeeds: InternalRecommendationSeed[] = [];
  for (const recommendation of sortedRecommendations) {
    const node = nodeByServiceId.get(recommendation.serviceId);
    const validatedProcess = validatedBiaByServiceId.get(recommendation.serviceId);
    const state = parsePersistedRecommendationState(node?.metadata);
    const nodeType = node?.type || 'APPLICATION';
    const provider = node?.provider || 'unknown';
    const metadata = (node?.metadata as Record<string, unknown>) || {};
    const identity = resolveServiceIdentity({
      name: node?.name ?? recommendation.serviceName,
      businessName: node?.businessName ?? null,
      type: nodeType,
      metadata,
    });

    if (
      isServiceResilientByDesign({
        nodeType,
        provider,
        metadata,
      })
    ) {
      continue;
    }

    const monthlyCostEstimate = await estimateServiceMonthlyProductionCostAsync(
      {
        type: nodeType,
        provider,
        metadata,
        criticalityScore: node?.criticalityScore ?? validatedProcess?.criticalityScore ?? null,
        impactCategory: node?.impactCategory ?? validatedProcess?.impactCategory ?? null,
      },
      profile.currency,
    );
    if (monthlyCostEstimate.estimatedMonthlyCost <= 0) {
      appLogger.warn('landing_zone.pricing_invariant_violation', {
        tenantId,
        serviceId: recommendation.serviceId,
        serviceName: identity.displayName,
        nodeType,
        provider,
        pricingSource: monthlyCostEstimate.pricingSource,
      });
    }

    const criticality = normalizeCriticality(
      validatedProcess?.recoveryTier ?? recommendation.recoveryTier,
      validatedProcess?.criticalityScore ?? node?.criticalityScore ?? null,
      validatedProcess?.impactCategory ?? node?.impactCategory ?? null,
    );
    const estimatedProductionMonthlyCost = monthlyCostEstimate.estimatedMonthlyCost;

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
      monthlyProductionCost: estimatedProductionMonthlyCost,
      overrideStrategy: resolveStrategyOverride(metadata),
      nodeType,
      provider,
      metadata,
    });
    const improvingStrategy = findNextImprovingStrategy(selected.strategy, currentRtoMinutes);
    const effectiveStrategy = improvingStrategy ?? selected.strategy;
    const strategyHasRtoGain = improvingStrategy != null;
    if (!strategyHasRtoGain) {
      appLogger.warn('landing_zone.recommendation_skipped_no_rto_gain', {
        tenantId,
        serviceId: recommendation.serviceId,
        serviceName: identity.displayName,
        strategy: selected.strategy,
        currentRtoMinutes,
      });
    }

    const strategyUpgraded = effectiveStrategy !== selected.strategy;
    const monthlyDrCost = strategyUpgraded
      ? estimateStrategyMonthlyDrCost(estimatedProductionMonthlyCost, effectiveStrategy, {
          nodeType,
          provider,
          metadata,
        })
      : selected.monthlyDrCost;
    const annualDrCost = roundMoney(monthlyDrCost * 12);
    const budgetWarning = strategyUpgraded
      ? selected.budgetWarning
        ? `${selected.budgetWarning} | Ajustement RTO: strategie relevee pour garantir un gain de reprise.`
        : 'Ajustement RTO: strategie relevee pour garantir un gain de reprise.'
      : selected.budgetWarning;
    const noGainWarning = strategyHasRtoGain
      ? null
      : 'Strategie conservee: aucun gain RTO supplementaire detecte sur ce service.';
    const combinedBudgetWarning =
      budgetWarning && noGainWarning
        ? `${budgetWarning} | ${noGainWarning}`
        : budgetWarning || noGainWarning;

    const strategy = strategyKeyToLegacySlug(effectiveStrategy);
    const probability = resolveIncidentProbabilityForNodeType(
      node?.type || identity.technicalName,
      undefined,
      metadata,
    );
    const serviceSpecificRecommendation = buildServiceSpecificRecommendation({
      serviceName: identity.displayName,
      nodeType,
      provider,
      metadata,
      strategy: effectiveStrategy,
      monthlyDrCost,
      baseMonthlyCost: estimatedProductionMonthlyCost,
      currency: profile.currency,
      nodeId: recommendation.serviceId,
      pricingSource: monthlyCostEstimate.pricingSource,
      pricingConfidence: monthlyCostEstimate.confidence,
    });
    if (serviceSpecificRecommendation.resilientByDesign) {
      continue;
    }
    const requiresVerification = serviceSpecificRecommendation.requiresVerification === true;

    recommendationSeeds.push({
      id: recommendation.serviceId,
      nodeId: recommendation.serviceId,
      serviceName: identity.displayName,
      serviceDisplayName: identity.displayName,
      serviceTechnicalName: identity.technicalName,
      tier: recommendation.recoveryTier,
      strategyKey: effectiveStrategy,
      strategy,
      estimatedCost: monthlyDrCost,
      estimatedAnnualCost: annualDrCost,
      estimatedProductionMonthlyCost,
      costSource: monthlyCostEstimate.pricingSource,
      costSourceLabel: monthlyCostEstimate.pricingSourceLabel,
      costConfidence: monthlyCostEstimate.confidence,
      description: serviceSpecificRecommendation.text,
      priority: recommendation.priorityScore,
      notes: state.notes,
      status: state.status,
      statusUpdatedAt: state.updatedAt,
      statusHistory: state.history,
      budgetWarning: combinedBudgetWarning,
      accepted: acceptedFromStatus(state.status),
      probabilitySource: probability.source,
      criticality,
      nodeType,
      provider,
      metadata,
      groupKey: null,
      allocationShare: 1,
      recommendationBand: 'primary',
      costCountedInSummary: true,
      requiresVerification,
    });
  }

  const duplicateDisplayNames = new Map<string, number>();
  for (const seed of recommendationSeeds) {
    const key = normalizeDisplayKey(seed.serviceDisplayName);
    duplicateDisplayNames.set(key, (duplicateDisplayNames.get(key) || 0) + 1);
  }

  const adjustedRecommendationSeeds = recommendationSeeds.map((seed) => {
    const duplicateCount = duplicateDisplayNames.get(normalizeDisplayKey(seed.serviceDisplayName)) || 0;
    if (duplicateCount <= 1) return seed;

    return {
      ...seed,
      serviceDisplayName: `${seed.serviceDisplayName} (${seed.nodeType})`,
    };
  });

  const withinBudgetByRecommendationId = new Map<string, boolean>();
  let runningBudgetAnnual = 0;
  for (const seed of adjustedRecommendationSeeds) {
    if (configuredBudgetAnnual == null) {
      withinBudgetByRecommendationId.set(seed.id, true);
      continue;
    }

    const annualCost = roundMoney(Math.max(0, seed.estimatedAnnualCost));
    const withinBudget =
      annualCost <= 0 || runningBudgetAnnual + annualCost <= configuredBudgetAnnual;
    withinBudgetByRecommendationId.set(seed.id, withinBudget);
    if (withinBudget) {
      runningBudgetAnnual = roundMoney(runningBudgetAnnual + annualCost);
    }
  }

  await Promise.all(
    adjustedRecommendationSeeds.map((entry) =>
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

  const recommendationInputs: RecommendationInput[] = adjustedRecommendationSeeds.map((entry) => ({
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

  const initialRoi = FinancialEngineService.calculateROI(
    financialContext.analysisResult,
    financialContext.biaResult,
    recommendationInputs,
    financialProfileInput,
    financialContext.overridesByNodeId,
    resolvedNodeCosts,
  );

  const initialBreakdownByRecommendationId = new Map(
    initialRoi.breakdownByRecommendation.map((entry) => [entry.recommendationId, entry]),
  );
  const costPartition = partitionRecommendationsByAleCap(
    adjustedRecommendationSeeds.map((entry) => {
      const breakdown = initialBreakdownByRecommendationId.get(entry.id);
      return {
        id: entry.id,
        annualCost: entry.estimatedAnnualCost,
        roi: breakdown?.individualROI ?? null,
        riskAvoidedAnnual: breakdown?.riskReduction ?? 0,
        priority: entry.priority,
      };
    }),
    ale.totalALE,
    0.35,
    profile.estimatedDrBudgetAnnual,
  );
  const primaryRecommendationInputs = recommendationInputs.filter((entry) =>
    costPartition.primaryIds.has(String(entry.recommendationId || entry.id || '')),
  );
  const roi =
    primaryRecommendationInputs.length === recommendationInputs.length
      ? initialRoi
      : FinancialEngineService.calculateROI(
          financialContext.analysisResult,
          financialContext.biaResult,
          primaryRecommendationInputs,
          financialProfileInput,
          financialContext.overridesByNodeId,
          resolvedNodeCosts,
        );

  const breakdownByRecommendationId = new Map(
    roi.breakdownByRecommendation.map((entry) => [entry.recommendationId, entry]),
  );
  const blastGraphNodes = graph.nodes().map(
    (id) => graph.getNodeAttributes(id) as InfraNodeAttrs,
  );
  const blastGraphEdges = graph.edges().map((edgeKey) => {
    const attrs = graph.getEdgeAttributes(edgeKey) as { type?: string };
    return {
      sourceId: graph.source(edgeKey),
      targetId: graph.target(edgeKey),
      type: String(attrs.type || ''),
    };
  });
  const blastResults = calculateBlastRadius(blastGraphNodes, blastGraphEdges);
  const serviceOverrides = Object.entries(financialContext.overridesByNodeId)
    .filter(([, override]) => Number(override?.customCostPerHour || 0) > 0)
    .map(([nodeId, override]) => ({
      nodeId,
      customDowntimeCostPerHour: Number(override?.customCostPerHour || 0),
    }));
  const downtimeCostByNodeId = new Map(
    calculateServiceDowntimeCosts(
      blastResults,
      adjustedRecommendationSeeds.map((seed) => ({
        nodeId: seed.nodeId,
        name: seed.serviceName,
        criticality: seed.criticality,
        nodeType: seed.nodeType,
        provider: seed.provider,
        metadata: seed.metadata,
        estimatedMonthlyCost: seed.estimatedProductionMonthlyCost,
      })),
      {
        estimatedDowntimeCostPerHour:
          Number(profile.customDowntimeCostPerHour || 0) || Number(profile.hourlyDowntimeCost || 0),
        serviceOverrides,
      },
    ).map((item) => [item.serviceNodeId, item]),
  );

  const recommendations: LandingZoneFinancialRecommendation[] = adjustedRecommendationSeeds.map((seed) => {
    const isSecondary = costPartition.secondaryIds.has(seed.id);
    const withinBudgetCap = withinBudgetByRecommendationId.get(seed.id) ?? true;
    const recommendationBand: LandingZoneFinancialRecommendation['recommendationBand'] = isSecondary
      ? 'secondary'
      : 'primary';
    const breakdown = isSecondary
      ? initialBreakdownByRecommendationId.get(seed.id)
      : breakdownByRecommendationId.get(seed.id);
    const downtimeCost = downtimeCostByNodeId.get(seed.nodeId);
    if (!breakdown) {
      appLogger.warn('landing_zone.recommendation_filtered_missing_breakdown', {
        tenantId,
        serviceId: seed.id,
        serviceName: seed.serviceName,
      });
    } else if (breakdown.projectedALE >= breakdown.currentALE || breakdown.riskReduction <= 0) {
      appLogger.warn('landing_zone.recommendation_filtered_non_positive_gain', {
        tenantId,
        serviceId: seed.id,
        serviceName: seed.serviceName,
        aleBefore: breakdown.currentALE,
        aleAfter: breakdown.projectedALE,
        riskReduction: breakdown.riskReduction,
      });
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
    const annualDrCost = breakdown?.annualCost ?? seed.estimatedAnnualCost;
    const riskAvoidedAnnual = breakdown?.riskReduction ?? 0;
    const aleCurrent = breakdown?.currentALE ?? 0;
    const aleAfter = breakdown?.projectedALE ?? Math.max(0, aleCurrent - riskAvoidedAnnual);
    const capWarning = !withinBudgetCap && configuredBudgetAnnual != null
      ? `Recommendation hors budget DR configure (${Math.round(configuredBudgetAnnual)} ${profile.currency}/an).`
      : null;
    const combinedBudgetWarning =
      seed.budgetWarning && capWarning
        ? `${seed.budgetWarning} | ${capWarning}`
        : seed.budgetWarning || capWarning;

    return {
      id: seed.id,
      nodeId: seed.nodeId,
      serviceName: seed.serviceName,
      serviceDisplayName: seed.serviceDisplayName,
      serviceTechnicalName: seed.serviceTechnicalName,
      tier: seed.tier,
      groupKey: seed.groupKey,
      allocationShare: seed.allocationShare,
      recommendationBand,
      costCountedInSummary: !isSecondary && seed.costCountedInSummary,
      strategy: seed.strategy,
      estimatedCost: seed.estimatedCost,
      estimatedAnnualCost: seed.estimatedAnnualCost,
      estimatedProductionMonthlyCost: seed.estimatedProductionMonthlyCost,
      costSource: seed.costSource,
      costSourceLabel: seed.costSourceLabel,
      costConfidence: seed.costConfidence,
      roiReliable: financialProfileConfigured,
      roi: breakdown?.individualROI ?? null,
      roiStatus: breakdown?.roiStatus ?? (riskAvoidedAnnual > 0 ? 'rentable' : 'non_applicable'),
      roiMessage: breakdown?.roiMessage ?? (riskAvoidedAnnual > 0 ? 'Rentable' : 'Non applicable'),
      paybackMonths: breakdown?.paybackMonths ?? null,
      paybackLabel: breakdown?.paybackLabel ?? 'Non rentable',
      accepted: seed.accepted,
      status: seed.status,
      statusUpdatedAt: seed.statusUpdatedAt,
      statusHistory: seed.statusHistory,
      description: seed.description,
      priority: seed.priority,
      notes: seed.notes,
      budgetWarning: combinedBudgetWarning,
      requiresVerification: seed.requiresVerification,
      withinBudgetCap,
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
      downtimeCostPerHour: downtimeCost?.downtimeCostPerHour ?? 0,
      downtimeCostSource: downtimeCost?.source ?? 'not_configured',
      downtimeCostSourceLabel: downtimeCost?.sourceLabel ?? '-',
      downtimeCostRationale: downtimeCost?.rationale ?? 'Profil financier non configure',
      ...(downtimeCost?.blastRadius ? { blastRadius: downtimeCost.blastRadius } : {}),
    };
  }).sort((left, right) => {
    if (left.recommendationBand !== right.recommendationBand) {
      return left.recommendationBand === 'primary' ? -1 : 1;
    }
    return right.priority - left.priority;
  });

  const recommendationInputById = new Map<string, RecommendationInput>(
    recommendationInputs
      .map((entry) => [String(entry.recommendationId || entry.id || ''), entry] as const)
      .filter((entry) => entry[0].length > 0),
  );
  const filteredRecommendationInputs = recommendations
    .filter((recommendation) => recommendation.recommendationBand !== 'secondary')
    .map((recommendation) => recommendationInputById.get(recommendation.id))
    .filter((entry): entry is RecommendationInput => Boolean(entry));

  const totalCostAnnual = roi.annualRemediationCost;
  const totalCostMonthly = roundMoney(totalCostAnnual / 12);
  const cappedRiskAvoidedAnnual = Math.min(
    Math.max(0, roi.riskReductionAmount),
    Math.max(0, ale.totalALE),
  );
  if (cappedRiskAvoidedAnnual < roi.riskReductionAmount) {
    appLogger.error('landing_zone.summary.risk_avoided_capped_to_annual_risk', {
      tenantId,
      annualRisk: ale.totalALE,
      rawRiskAvoidedAnnual: roi.riskReductionAmount,
      cappedRiskAvoidedAnnual,
    });
  }
  const recommendationsCountedInSummary = recommendations.filter((entry) => {
    if (entry.recommendationBand === 'secondary' || !entry.costCountedInSummary) {
      return false;
    }

    const breakdown = breakdownByRecommendationId.get(entry.id);
    return Boolean(breakdown) && (breakdown?.annualCost || 0) > 0;
  });

  const byStrategy: Record<string, number> = {};
  const annualCostByStrategy: Record<string, number> = {};
  for (const recommendation of recommendationsCountedInSummary) {
    const annualCost = roundMoney(
      breakdownByRecommendationId.get(recommendation.id)?.annualCost ?? recommendation.estimatedAnnualCost,
    );
    byStrategy[recommendation.strategy] = (byStrategy[recommendation.strategy] || 0) + 1;
    annualCostByStrategy[recommendation.strategy] =
      roundMoney((annualCostByStrategy[recommendation.strategy] || 0) + annualCost);
  }

  const costSharePercentByStrategy = normalizeStrategyCostPercentages(
    Object.entries(annualCostByStrategy).map(([strategy, absoluteCost]) => ({
      strategy,
      absoluteCost,
    })),
  );
  const selectedAnnualCost = roundMoney(
    recommendations
      .filter((entry) => entry.withinBudgetCap && entry.status === 'validated')
      .reduce((sum, entry) => sum + entry.estimatedAnnualCost, 0),
  );
  const remainingBudgetAnnual =
    configuredBudgetAnnual != null
      ? roundMoney(Math.max(0, configuredBudgetAnnual - selectedAnnualCost))
      : null;

  return {
    recommendations,
    summary: {
      totalCostMonthly,
      totalCostAnnual,
      byStrategy,
      annualCostByStrategy,
      costSharePercentByStrategy,
      totalRecommendations: recommendationsCountedInSummary.length,
      secondaryRecommendations: recommendations.filter((entry) => entry.recommendationBand === 'secondary').length,
      secondaryAnnualCost: roundMoney(
        recommendations
          .filter((entry) => entry.recommendationBand === 'secondary')
          .reduce((sum, entry) => sum + entry.estimatedAnnualCost, 0),
      ),
      annualCostCap: roundMoney(costPartition.annualCap),
      budgetAnnual: configuredBudgetAnnual,
      selectedAnnualCost,
      remainingBudgetAnnual,
      riskAvoidedAnnual: roundMoney(cappedRiskAvoidedAnnual),
      roiPercent: roi.roiPercent,
      paybackMonths: roi.paybackMonths,
      paybackLabel: roi.paybackLabel,
      financialProfileConfigured,
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

