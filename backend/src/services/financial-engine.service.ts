import type { DriftEvent, OrganizationProfile } from '@prisma/client';
import {
  DOWNTIME_COST_BENCHMARKS,
  NODE_TYPE_COST_MULTIPLIERS,
  ORG_SIZE_MULTIPLIERS,
  RECOVERY_STRATEGY_COSTS,
  STRATEGY_RISK_REDUCTION,
  SUPPORTED_CURRENCIES,
  type OrganizationSizeCategory,
  type RecoveryStrategyKey,
  type SupportedCurrency,
  type VerticalSectorKey,
} from '../constants/market-financial-data.js';

export type FinancialConfidence = 'user_defined' | 'estimated' | 'low_confidence';

export type FinancialNodeInput = {
  id: string;
  name: string;
  type: string;
  provider?: string | null;
  region?: string | null;
  isSPOF?: boolean;
  criticalityScore?: number | null;
  redundancyScore?: number | null;
  impactCategory?: string | null;
  suggestedRTO?: number | null;
  validatedRTO?: number | null;
  suggestedRPO?: number | null;
  validatedRPO?: number | null;
  suggestedMTPD?: number | null;
  validatedMTPD?: number | null;
  dependentsCount?: number;
  inEdges?: Array<unknown>;
  outEdges?: Array<unknown>;
};

export type BIAProcessInput = {
  serviceNodeId: string;
  recoveryTier?: number | null;
  suggestedRTO?: number | null;
  validatedRTO?: number | null;
  suggestedRPO?: number | null;
  validatedRPO?: number | null;
  suggestedMTPD?: number | null;
  validatedMTPD?: number | null;
};

export type AnalysisResultInput = {
  nodes: FinancialNodeInput[];
};

export type BIAResultInput = {
  processes: BIAProcessInput[];
};

export type RecommendationInput = {
  id?: string;
  recommendationId?: string;
  strategy?: string;
  targetNodes?: string[];
  affectedNodeIds?: string[];
  category?: string;
  priority?: string;
  annualCost?: number;
  monthlyCost?: number;
};

export type NodeFinancialOverrideInput = {
  customCostPerHour: number;
  justification?: string | null;
  validatedBy?: string | null;
  validatedAt?: Date | null;
};

export type ResolvedNodeFinancialCostInput = {
  costPerHour: number;
  method?: string;
  confidence?: string;
  sources?: string[];
  fallbackEstimate?: number | null;
};

export type FinancialOrganizationProfileInput = {
  sizeCategory?: string | null;
  verticalSector?: string | null;
  customDowntimeCostPerHour?: number | null;
  customCurrency?: string | null;
  strongholdPlanId?: string | null;
  strongholdMonthlyCost?: number | null;
};

export type NodeFinancialImpactResult = {
  estimatedCostPerHour: number;
  confidence: FinancialConfidence;
  breakdown: {
    nodeType: string;
    typeMultiplier: number;
    dependentsCount: number;
    orgSizeMultiplier: number;
    baseCost: number;
    verticalAdjustedCost: number | null;
    organizationOverrideAdjustedCost: number | null;
    finalCost: number;
    currency: SupportedCurrency;
  };
  sources: string[];
};

export type AnnualExpectedLossResult = {
  totalALE: number;
  aleByTier: {
    tier1_mission_critical: number;
    tier2_business_critical: number;
    tier3_important: number;
    tier4_non_critical: number;
  };
  aleBySPOF: Array<{
    nodeId: string;
    nodeName: string;
    nodeType: string;
    ale: number;
    probability: number;
    estimatedDowntimeHours: number;
    costPerHour: number;
    dependentsCount: number;
    costMethod?: string;
    costConfidence?: string;
    fallbackEstimate?: number | null;
  }>;
  totalSPOFs: number;
  avgDowntimeHoursPerIncident: number;
  methodology: string;
  sources: string[];
  disclaimer: string;
  currency: SupportedCurrency;
  calculatedAt: Date;
};

export type ROIResult = {
  currentALE: number;
  projectedALE: number;
  riskReduction: number;
  riskReductionAmount: number;
  annualRemediationCost: number;
  netAnnualSavings: number;
  roiPercent: number;
  paybackMonths: number;
  strongholdSubscriptionAnnual: number;
  breakdownByRecommendation: Array<{
    recommendationId: string;
    strategy: string;
    targetNodes: string[];
    annualCost: number;
    riskReduction: number;
    individualROI: number;
  }>;
  methodology: string;
  sources: string[];
  disclaimer: string;
  currency: SupportedCurrency;
  calculatedAt: Date;
};

export type DriftFinancialImpactResult = {
  driftId: string;
  financialImpact: {
    additionalAnnualRisk: number;
    rtoDelta: number;
    rpoDelta: number;
    explanation: string;
  };
  severity: 'critical' | 'high' | 'medium' | 'low';
  source: string;
};

type InternalNodeLoss = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  isSPOF: boolean;
  recoveryTier: number;
  probability: number;
  estimatedDowntimeHours: number;
  costPerHour: number;
  dependentsCount: number;
  ale: number;
  costMethod: string;
  costConfidence: string;
  fallbackEstimate: number | null;
};

const FX_USD_TO_TARGET: Record<SupportedCurrency, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CHF: 0.88,
};

const STRONGHOLD_PLAN_MONTHLY_COST: Record<string, number> = {
  STARTER: 200,
  PRO: 800,
  ENTERPRISE: 2_000,
  OWNER: 0,
  CUSTOM: 1_500,
};

const DEFAULT_DISCLAIMER =
  'Estimated values based on public market benchmarks and conservative assumptions. Adjust values with your finance and infrastructure teams for your specific context.';

const ROI_DISCLAIMER =
  'Ces estimations sont basees sur des donnees marche publiques et des hypotheses de reduction de risque. Les couts reels dependent de votre contexte specifique. Consultez vos equipes finance et infrastructure pour valider ces chiffres.';

function roundAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

function normalizeSizeCategory(rawSize: string | null | undefined): OrganizationSizeCategory {
  if (!rawSize) return 'midMarket';
  if (rawSize in ORG_SIZE_MULTIPLIERS) {
    return rawSize as OrganizationSizeCategory;
  }
  return 'midMarket';
}

function normalizeCurrency(rawCurrency: string | null | undefined): SupportedCurrency {
  const upper = String(rawCurrency || 'EUR').toUpperCase();
  if ((SUPPORTED_CURRENCIES as readonly string[]).includes(upper)) {
    return upper as SupportedCurrency;
  }
  return 'EUR';
}

function normalizeRecoveryStrategy(rawStrategy: string | undefined, fallback: RecoveryStrategyKey): RecoveryStrategyKey {
  const normalized = (rawStrategy || '').toLowerCase().replace(/[-\s]/g, '_');
  if (normalized in RECOVERY_STRATEGY_COSTS) {
    return normalized as RecoveryStrategyKey;
  }
  return fallback;
}

function normalizeCriticality(score: number | null | undefined): number {
  if (!Number.isFinite(score as number)) return 0;
  const safe = Number(score);
  if (safe > 1) {
    return Math.max(0, Math.min(1, safe / 100));
  }
  return Math.max(0, Math.min(1, safe));
}

function normalizeRedundancy(score: number | null | undefined): number {
  if (!Number.isFinite(score as number)) return 0;
  const safe = Number(score);
  if (safe > 1) {
    return Math.max(0, Math.min(1, safe / 100));
  }
  return Math.max(0, Math.min(1, safe));
}

function countDependents(node: FinancialNodeInput): number {
  if (Number.isFinite(node.dependentsCount) && (node.dependentsCount as number) >= 0) {
    return Math.max(0, Number(node.dependentsCount));
  }
  if (Array.isArray(node.inEdges)) {
    return node.inEdges.length;
  }
  return 0;
}

function getTierFromNode(node: FinancialNodeInput, processMap: Map<string, BIAProcessInput>): number {
  const process = processMap.get(node.id);
  if (process?.recoveryTier && process.recoveryTier >= 1 && process.recoveryTier <= 4) {
    return process.recoveryTier;
  }

  const impact = String(node.impactCategory || '').toLowerCase();
  if (impact.includes('tier1') || impact.includes('mission')) return 1;
  if (impact.includes('tier2') || impact.includes('business')) return 2;
  if (impact.includes('tier3') || impact.includes('important')) return 3;
  if (impact.includes('tier4') || impact.includes('non')) return 4;

  const criticality = normalizeCriticality(node.criticalityScore);
  if (criticality >= 0.85) return 1;
  if (criticality >= 0.65) return 2;
  if (criticality >= 0.45) return 3;
  return 4;
}

function getRtoHours(node: FinancialNodeInput, processMap: Map<string, BIAProcessInput>): number {
  const process = processMap.get(node.id);
  const rtoMinutes =
    process?.validatedRTO ??
    process?.suggestedRTO ??
    node.validatedRTO ??
    node.suggestedRTO ??
    240;

  const minutes = Math.max(1, Number(rtoMinutes));
  return Number((minutes / 60).toFixed(2));
}

function buildNodeSourceStrings(
  nodeType: string,
  sizeCategory: OrganizationSizeCategory,
  verticalSector?: string | null,
): string[] {
  const sources = [
    'Stronghold estimate - NODE_TYPE_COST_MULTIPLIERS',
    `Stronghold estimate - ORG_SIZE_MULTIPLIERS (${sizeCategory})`,
    `ITIC benchmark: ${DOWNTIME_COST_BENCHMARKS.midMarket.source}`,
    DOWNTIME_COST_BENCHMARKS.midMarket.sourceUrl,
  ];

  const normalizedType = nodeType.toUpperCase();
  if (!(normalizedType in NODE_TYPE_COST_MULTIPLIERS)) {
    sources.push('Fallback multiplier used for unknown node type');
  }

  if (verticalSector && verticalSector in DOWNTIME_COST_BENCHMARKS.byVertical) {
    const vertical =
      DOWNTIME_COST_BENCHMARKS.byVertical[verticalSector as VerticalSectorKey];
    sources.push(`Vertical benchmark: ${vertical.source}`);
  }

  return Array.from(new Set(sources));
}

function resolveFxMultiplier(currency: SupportedCurrency): number {
  return FX_USD_TO_TARGET[currency] ?? 1;
}

function resolveProbability(node: FinancialNodeInput): {
  probability: number;
  rationale: string;
  source: string;
} {
  const isSPOF = Boolean(node.isSPOF);
  const redundancy = normalizeRedundancy(node.redundancyScore);
  const criticality = normalizeCriticality(node.criticalityScore);

  if (isSPOF && redundancy <= 0.3) {
    return {
      probability: 0.15,
      rationale: 'SPOF with low redundancy',
      source: 'Uptime Institute 2024-2025 average infrastructure failure rates',
    };
  }

  if (isSPOF) {
    return {
      probability: 0.05,
      rationale: 'SPOF with partial redundancy',
      source: 'Uptime Institute 2024-2025 average infrastructure failure rates',
    };
  }

  if (criticality > 0.7) {
    return {
      probability: 0.03,
      rationale: 'Non-SPOF but high criticality component',
      source: 'Uptime Institute 2024-2025 average infrastructure failure rates',
    };
  }

  return {
    probability: 0,
    rationale: 'Not in tracked risk scope',
    source: 'Stronghold probability rules',
  };
}

function dedupeSources(...groups: Array<string[]>): string[] {
  const all = groups.flat().filter(Boolean);
  return Array.from(new Set(all));
}

function recommendationTargetNodes(recommendation: RecommendationInput): string[] {
  const list = recommendation.targetNodes ?? recommendation.affectedNodeIds ?? [];
  return Array.from(new Set(list.filter((nodeId) => typeof nodeId === 'string' && nodeId.length > 0)));
}

function recommendationDefaultStrategy(
  recommendation: RecommendationInput,
  nodeLookup: Map<string, FinancialNodeInput>,
): RecoveryStrategyKey {
  if (recommendation.strategy) {
    return normalizeRecoveryStrategy(recommendation.strategy, 'warm_standby');
  }

  const targetNodes = recommendationTargetNodes(recommendation);
  const targetTypes = targetNodes
    .map((nodeId) => nodeLookup.get(nodeId)?.type?.toUpperCase() || '')
    .filter(Boolean);

  const hasStatefulCriticalType = targetTypes.some((type) =>
    ['DATABASE', 'API_GATEWAY', 'LOAD_BALANCER', 'DNS'].includes(type),
  );

  if (recommendation.category === 'backup') return 'backup_restore';
  if (recommendation.category === 'monitoring') return 'pilot_light';
  if (recommendation.category === 'process') return 'warm_standby';
  if (recommendation.priority === 'P0' && hasStatefulCriticalType) return 'active_active';
  if (hasStatefulCriticalType) return 'warm_standby';
  return 'pilot_light';
}

function strategyAnnualCost(strategy: RecoveryStrategyKey, targetNodeCount: number, fxMultiplier: number): number {
  const monthly = RECOVERY_STRATEGY_COSTS[strategy].monthlyEstimateUSD;
  const medianMonthly = (monthly.min + monthly.max) / 2;
  const normalizedTargetCount = Math.max(1, targetNodeCount);
  return roundAmount(medianMonthly * 12 * normalizedTargetCount * fxMultiplier);
}

function ensureProfileDefaults(
  profile: FinancialOrganizationProfileInput | OrganizationProfile | null | undefined,
): Required<Pick<FinancialOrganizationProfileInput, 'sizeCategory' | 'customCurrency'>> &
  FinancialOrganizationProfileInput {
  const sizeCategory = normalizeSizeCategory(profile?.sizeCategory ?? 'midMarket');
  const customCurrency = normalizeCurrency(profile?.customCurrency ?? 'EUR');
  return {
    ...profile,
    sizeCategory,
    customCurrency,
  };
}

function buildNodeLossContributions(
  analysisResult: AnalysisResultInput,
  biaResult: BIAResultInput,
  orgProfile: FinancialOrganizationProfileInput,
  overridesByNodeId: Record<string, NodeFinancialOverrideInput | undefined>,
  resolvedNodeCostsByNodeId: Record<string, ResolvedNodeFinancialCostInput | undefined> = {},
): { losses: InternalNodeLoss[]; sources: string[] } {
  const processMap = new Map(
    (biaResult.processes || []).map((process) => [process.serviceNodeId, process]),
  );

  const losses: InternalNodeLoss[] = [];
  const sources: string[] = [];

  for (const node of analysisResult.nodes || []) {
    const probabilityRule = resolveProbability(node);
    if (probabilityRule.probability <= 0) continue;

    const resolvedCost = resolvedNodeCostsByNodeId[node.id];
    const impact =
      resolvedCost && resolvedCost.costPerHour > 0
        ? null
        : FinancialEngineService.calculateNodeFinancialImpact(
            node,
            orgProfile,
            overridesByNodeId[node.id],
          );

    const resolvedCostPerHour =
      resolvedCost && Number.isFinite(resolvedCost.costPerHour) && resolvedCost.costPerHour > 0
        ? roundAmount(resolvedCost.costPerHour)
        : null;
    const costPerHour = resolvedCostPerHour ?? (impact ? impact.estimatedCostPerHour : 0);
    const costMethod =
      resolvedCost?.method ??
      (impact?.confidence === 'user_defined' ? 'user_override' : 'legacy_estimate');
    const costConfidence = String(resolvedCost?.confidence ?? impact?.confidence ?? 'low_confidence');
    const fallbackEstimate = resolvedCost?.fallbackEstimate ?? null;

    const downtimeHours = getRtoHours(node, processMap);
    const ale = probabilityRule.probability * downtimeHours * costPerHour;

    losses.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      isSPOF: Boolean(node.isSPOF),
      recoveryTier: getTierFromNode(node, processMap),
      probability: probabilityRule.probability,
      estimatedDowntimeHours: downtimeHours,
      costPerHour,
      dependentsCount: countDependents(node),
      ale,
      costMethod,
      costConfidence,
      fallbackEstimate,
    });

    sources.push(
      probabilityRule.source,
      ...(impact?.sources || []),
      ...(resolvedCost?.sources || []),
    );
  }

  return {
    losses,
    sources: dedupeSources(sources),
  };
}

export class FinancialEngineService {
  static calculateNodeFinancialImpact(
    node: FinancialNodeInput,
    orgProfile?: FinancialOrganizationProfileInput | OrganizationProfile | null,
    override?: NodeFinancialOverrideInput | null,
  ): NodeFinancialImpactResult {
    const profile = ensureProfileDefaults(orgProfile);
    const sizeCategory = normalizeSizeCategory(profile.sizeCategory);
    const currency = normalizeCurrency(profile.customCurrency);
    const fxMultiplier = resolveFxMultiplier(currency);

    const dependentsCount = Math.max(1, countDependents(node));
    const nodeType = String(node.type || 'APPLICATION').toUpperCase();
    const defaultMultiplier = NODE_TYPE_COST_MULTIPLIERS.APPLICATION || 200;
    const typeMultiplier = NODE_TYPE_COST_MULTIPLIERS[nodeType] ?? defaultMultiplier;
    const orgSizeMultiplier = ORG_SIZE_MULTIPLIERS[sizeCategory];

    const baseCostUSD = typeMultiplier * dependentsCount * orgSizeMultiplier;

    if (override?.customCostPerHour && override.customCostPerHour > 0) {
      return {
        estimatedCostPerHour: roundAmount(override.customCostPerHour),
        confidence: 'user_defined',
        breakdown: {
          nodeType,
          typeMultiplier,
          dependentsCount,
          orgSizeMultiplier,
          baseCost: roundAmount(baseCostUSD * fxMultiplier),
          verticalAdjustedCost: null,
          organizationOverrideAdjustedCost: null,
          finalCost: roundAmount(override.customCostPerHour),
          currency,
        },
        sources: dedupeSources([
          'User-defined node override',
          'Validated by tenant input',
          ...buildNodeSourceStrings(nodeType, sizeCategory, profile.verticalSector),
        ]),
      };
    }

    let estimatedCostUSD = baseCostUSD;
    let verticalAdjustedCost: number | null = null;
    let organizationOverrideAdjustedCost: number | null = null;

    const verticalKey = profile.verticalSector as VerticalSectorKey | undefined;
    if (verticalKey && verticalKey in DOWNTIME_COST_BENCHMARKS.byVertical) {
      const verticalBenchmarkUSD =
        DOWNTIME_COST_BENCHMARKS.byVertical[verticalKey].perHourUSD;
      const nodeWeight = Math.max(0.03, Math.min(0.4, (dependentsCount + 1) / 20));
      verticalAdjustedCost = roundAmount(verticalBenchmarkUSD * nodeWeight * fxMultiplier);
      estimatedCostUSD = Math.max(estimatedCostUSD, verticalBenchmarkUSD * nodeWeight);
    }

    if (profile.customDowntimeCostPerHour && profile.customDowntimeCostPerHour > 0) {
      const nodeWeight = Math.max(0.03, Math.min(0.5, (dependentsCount + 1) / 16));
      const weightedOverrideUSD = profile.customDowntimeCostPerHour * nodeWeight;
      organizationOverrideAdjustedCost = roundAmount(weightedOverrideUSD * fxMultiplier);
      estimatedCostUSD = Math.max(estimatedCostUSD, weightedOverrideUSD);
    }

    const estimatedCost = roundAmount(estimatedCostUSD * fxMultiplier);

    const confidence: FinancialConfidence =
      nodeType in NODE_TYPE_COST_MULTIPLIERS ? 'estimated' : 'low_confidence';

    return {
      estimatedCostPerHour: estimatedCost,
      confidence,
      breakdown: {
        nodeType,
        typeMultiplier,
        dependentsCount,
        orgSizeMultiplier,
        baseCost: roundAmount(baseCostUSD * fxMultiplier),
        verticalAdjustedCost,
        organizationOverrideAdjustedCost,
        finalCost: estimatedCost,
        currency,
      },
      sources: buildNodeSourceStrings(nodeType, sizeCategory, profile.verticalSector),
    };
  }

  static calculateAnnualExpectedLoss(
    analysisResult: AnalysisResultInput,
    biaResult: BIAResultInput,
    orgProfile?: FinancialOrganizationProfileInput | OrganizationProfile | null,
    overridesByNodeId: Record<string, NodeFinancialOverrideInput | undefined> = {},
    resolvedNodeCostsByNodeId: Record<string, ResolvedNodeFinancialCostInput | undefined> = {},
  ): AnnualExpectedLossResult {
    const profile = ensureProfileDefaults(orgProfile);
    const currency = normalizeCurrency(profile.customCurrency);

    const { losses, sources } = buildNodeLossContributions(
      analysisResult,
      biaResult,
      profile,
      overridesByNodeId,
      resolvedNodeCostsByNodeId,
    );

    const aleByTier = {
      tier1_mission_critical: 0,
      tier2_business_critical: 0,
      tier3_important: 0,
      tier4_non_critical: 0,
    };

    const aleBySPOF: AnnualExpectedLossResult['aleBySPOF'] = [];

    let totalALE = 0;
    let spofDowntimeSum = 0;
    let totalSPOFs = 0;

    for (const loss of losses) {
      totalALE += loss.ale;

      if (loss.recoveryTier === 1) {
        aleByTier.tier1_mission_critical += loss.ale;
      } else if (loss.recoveryTier === 2) {
        aleByTier.tier2_business_critical += loss.ale;
      } else if (loss.recoveryTier === 3) {
        aleByTier.tier3_important += loss.ale;
      } else {
        aleByTier.tier4_non_critical += loss.ale;
      }

      if (loss.isSPOF) {
        totalSPOFs += 1;
        spofDowntimeSum += loss.estimatedDowntimeHours;
        aleBySPOF.push({
          nodeId: loss.nodeId,
          nodeName: loss.nodeName,
          nodeType: loss.nodeType,
          ale: roundAmount(loss.ale),
          probability: loss.probability,
          estimatedDowntimeHours: Number(loss.estimatedDowntimeHours.toFixed(2)),
          costPerHour: roundAmount(loss.costPerHour),
          dependentsCount: loss.dependentsCount,
          costMethod: loss.costMethod,
          costConfidence: loss.costConfidence,
          fallbackEstimate: loss.fallbackEstimate,
        });
      }
    }

    aleBySPOF.sort((a, b) => b.ale - a.ale);

    return {
      totalALE: roundAmount(totalALE),
      aleByTier: {
        tier1_mission_critical: roundAmount(aleByTier.tier1_mission_critical),
        tier2_business_critical: roundAmount(aleByTier.tier2_business_critical),
        tier3_important: roundAmount(aleByTier.tier3_important),
        tier4_non_critical: roundAmount(aleByTier.tier4_non_critical),
      },
      aleBySPOF,
      totalSPOFs,
      avgDowntimeHoursPerIncident: Number(
        (totalSPOFs > 0 ? spofDowntimeSum / totalSPOFs : 0).toFixed(2),
      ),
      methodology:
        'ALE = sum(probability_of_incident x estimated_downtime_hours x hourly_impact_cost) on SPOFs and critical nodes. Probabilities are based on public outage averages (Uptime Institute 2024-2025).',
      sources: dedupeSources(sources, [
        'Uptime Institute 2024-2025 average infrastructure failure rates',
        DOWNTIME_COST_BENCHMARKS.enterprise.source,
        DOWNTIME_COST_BENCHMARKS.enterprise.sourceUrl,
      ]),
      disclaimer: DEFAULT_DISCLAIMER,
      currency,
      calculatedAt: new Date(),
    };
  }

  static calculateROI(
    analysisResult: AnalysisResultInput,
    biaResult: BIAResultInput,
    recommendations: RecommendationInput[],
    orgProfile?: FinancialOrganizationProfileInput | OrganizationProfile | null,
    overridesByNodeId: Record<string, NodeFinancialOverrideInput | undefined> = {},
    resolvedNodeCostsByNodeId: Record<string, ResolvedNodeFinancialCostInput | undefined> = {},
  ): ROIResult {
    const profile = ensureProfileDefaults(orgProfile);
    const currency = normalizeCurrency(profile.customCurrency);
    const fxMultiplier = resolveFxMultiplier(currency);

    const { losses, sources } = buildNodeLossContributions(
      analysisResult,
      biaResult,
      profile,
      overridesByNodeId,
      resolvedNodeCostsByNodeId,
    );

    const nodeLookup = new Map((analysisResult.nodes || []).map((node) => [node.id, node]));
    const nodeAleMap = new Map(losses.map((loss) => [loss.nodeId, loss.ale]));
    const nodeResidualFactor = new Map(losses.map((loss) => [loss.nodeId, 1]));

    const currentALE = losses.reduce((sum, loss) => sum + loss.ale, 0);
    const breakdownByRecommendation: ROIResult['breakdownByRecommendation'] = [];

    let remediationCostTotal = 0;

    for (const recommendation of recommendations || []) {
      const targetNodes = recommendationTargetNodes(recommendation);
      const strategy = recommendationDefaultStrategy(recommendation, nodeLookup);
      const reductionRate = STRATEGY_RISK_REDUCTION[strategy];

      const annualCost = roundAmount(
        recommendation.annualCost && recommendation.annualCost > 0
          ? recommendation.annualCost
          : recommendation.monthlyCost && recommendation.monthlyCost > 0
            ? recommendation.monthlyCost * 12
            : strategyAnnualCost(strategy, targetNodes.length || 1, fxMultiplier),
      );

      remediationCostTotal += annualCost;

      let recommendationRiskReduction = 0;
      for (const nodeId of targetNodes) {
        const baseNodeAle = nodeAleMap.get(nodeId);
        if (!baseNodeAle) continue;
        const currentFactor = nodeResidualFactor.get(nodeId) ?? 1;
        const reducedFactor = currentFactor * (1 - reductionRate);
        nodeResidualFactor.set(nodeId, reducedFactor);

        const nodeReduction = baseNodeAle * (currentFactor - reducedFactor);
        recommendationRiskReduction += nodeReduction;
      }

      if (targetNodes.length === 0 && currentALE > 0) {
        recommendationRiskReduction += currentALE * reductionRate * 0.05;
      }

      const individualROI =
        annualCost > 0
          ? ((recommendationRiskReduction - annualCost) / annualCost) * 100
          : 0;

      breakdownByRecommendation.push({
        recommendationId:
          recommendation.recommendationId || recommendation.id || `rec-${breakdownByRecommendation.length + 1}`,
        strategy,
        targetNodes,
        annualCost: roundAmount(annualCost),
        riskReduction: roundAmount(recommendationRiskReduction),
        individualROI: Number(individualROI.toFixed(2)),
      });
    }

    const projectedALE = losses.reduce((sum, loss) => {
      const residualFactor = nodeResidualFactor.get(loss.nodeId) ?? 1;
      return sum + loss.ale * residualFactor;
    }, 0);

    const strongholdSubscriptionAnnual = roundAmount(
      profile.strongholdMonthlyCost && profile.strongholdMonthlyCost > 0
        ? profile.strongholdMonthlyCost * 12
        : (STRONGHOLD_PLAN_MONTHLY_COST[String(profile.strongholdPlanId || 'PRO').toUpperCase()] ??
            STRONGHOLD_PLAN_MONTHLY_COST.PRO ??
            800) * 12,
    );

    const annualRemediationCost = roundAmount(remediationCostTotal + strongholdSubscriptionAnnual);
    const riskReductionAmount = Math.max(0, currentALE - projectedALE);
    const riskReduction = currentALE > 0 ? (riskReductionAmount / currentALE) * 100 : 0;
    const netAnnualSavings = riskReductionAmount - annualRemediationCost;
    const roiPercent =
      annualRemediationCost > 0 ? (netAnnualSavings / annualRemediationCost) * 100 : 0;

    const paybackMonths =
      netAnnualSavings > 0
        ? Number((annualRemediationCost / (netAnnualSavings / 12)).toFixed(2))
        : 999;

    return {
      currentALE: roundAmount(currentALE),
      projectedALE: roundAmount(projectedALE),
      riskReduction: Number(riskReduction.toFixed(2)),
      riskReductionAmount: roundAmount(riskReductionAmount),
      annualRemediationCost,
      netAnnualSavings: roundAmount(netAnnualSavings),
      roiPercent: Number(roiPercent.toFixed(2)),
      paybackMonths,
      strongholdSubscriptionAnnual,
      breakdownByRecommendation,
      methodology:
        'ROI = ((ALE_without_controls - ALE_with_controls - annual_remediation_cost) / annual_remediation_cost) x 100. Strategy reduction factors: Active-Active 95%, Warm Standby 80%, Pilot Light 60%, Backup & Restore 40%.',
      sources: dedupeSources(sources, [
        'Stronghold strategy reduction assumptions (conservative defaults)',
        RECOVERY_STRATEGY_COSTS.active_active.source,
        DOWNTIME_COST_BENCHMARKS.globalStats.uptimeSource,
      ]),
      disclaimer: ROI_DISCLAIMER,
      currency,
      calculatedAt: new Date(),
    };
  }

  static calculateDriftFinancialImpact(
    drift: Pick<DriftEvent, 'id' | 'type' | 'severity' | 'description' | 'details' | 'affectsSPOF' | 'affectsRTO'>,
    previousState: {
      isSPOF?: boolean;
      hasRedundancy?: boolean;
      rtoMinutes?: number;
      rpoMinutes?: number;
      inPRARegion?: boolean;
      inBIA?: boolean;
      hasBackup?: boolean;
      costPerHour?: number;
    } = {},
    currentState: {
      isSPOF?: boolean;
      hasRedundancy?: boolean;
      rtoMinutes?: number;
      rpoMinutes?: number;
      inPRARegion?: boolean;
      inBIA?: boolean;
      hasBackup?: boolean;
      costPerHour?: number;
    } = {},
  ): DriftFinancialImpactResult {
    const description = String(drift.description || '').toLowerCase();
    const costPerHour =
      Number(currentState.costPerHour) ||
      Number(previousState.costPerHour) ||
      500;

    let rtoDelta = 0;
    let rpoDelta = 0;
    let additionalAnnualRisk = 0;
    let explanation = 'Financial impact estimated from default drift risk rules.';

    const previousRto = Math.max(1, Number(previousState.rtoMinutes || 120));
    const currentRto = Math.max(1, Number(currentState.rtoMinutes || previousRto));
    const previousRpo = Math.max(1, Number(previousState.rpoMinutes || 60));
    const currentRpo = Math.max(1, Number(currentState.rpoMinutes || previousRpo));

    const redundancyLoss =
      description.includes('redund') ||
      description.includes('replica') ||
      Boolean(drift.affectsSPOF) ||
      (previousState.hasRedundancy === true && currentState.hasRedundancy === false);

    const regionDrift =
      description.includes('region') ||
      (previousState.inPRARegion === true && currentState.inPRARegion === false);

    const unmanagedNewService =
      description.includes('nouveau') ||
      description.includes('new service') ||
      (previousState.inBIA !== false && currentState.inBIA === false);

    const backupLoss =
      description.includes('backup') ||
      (previousState.hasBackup === true && currentState.hasBackup === false);

    if (redundancyLoss) {
      const prevProbability = previousState.isSPOF ? 0.05 : 0.03;
      const currProbability = currentState.isSPOF !== false ? 0.15 : 0.05;
      const effectiveCurrentRto = Math.max(currentRto, previousRto + 120);
      rtoDelta = effectiveCurrentRto - previousRto;
      additionalAnnualRisk +=
        currProbability * (effectiveCurrentRto / 60) * costPerHour -
        prevProbability * (previousRto / 60) * costPerHour;
      explanation = `Redundancy loss increases RTO by ${rtoDelta} minutes and raises annual expected loss by an estimated ${roundAmount(additionalAnnualRisk)}.`;
    }

    if (regionDrift) {
      const extraRto = 120;
      rtoDelta += extraRto;
      additionalAnnualRisk += 0.05 * (extraRto / 60) * costPerHour;
      explanation = `Region drift outside PRA perimeter adds approximately ${extraRto} minutes to failover and increases annual risk.`;
    }

    if (unmanagedNewService) {
      additionalAnnualRisk += 0.03 * 4 * costPerHour;
      explanation = `New service not included in BIA introduces uncovered risk estimated at ${roundAmount(0.03 * 4 * costPerHour)} per year.`;
    }

    if (backupLoss) {
      const effectiveCurrentRpo = Math.max(currentRpo, previousRpo + 120);
      rpoDelta = effectiveCurrentRpo - previousRpo;
      additionalAnnualRisk += 0.04 * (rpoDelta / 60) * costPerHour;
      explanation = `Backup degradation increases RPO by ${rpoDelta} minutes and elevates expected annual risk.`;
    }

    const normalizedRisk = Math.max(0, additionalAnnualRisk);

    let severity: DriftFinancialImpactResult['severity'] = 'low';
    if (normalizedRisk >= 100_000) severity = 'critical';
    else if (normalizedRisk >= 50_000) severity = 'high';
    else if (normalizedRisk >= 10_000) severity = 'medium';

    return {
      driftId: drift.id,
      financialImpact: {
        additionalAnnualRisk: roundAmount(normalizedRisk),
        rtoDelta,
        rpoDelta,
        explanation,
      },
      severity,
      source: 'Stronghold drift risk model based on Uptime Institute 2024-2025 outage data',
    };
  }
}

