import type { DriftEvent, OrganizationProfile } from '@prisma/client';
import { appLogger } from '../utils/logger.js';
import {
  DOWNTIME_COST_BENCHMARKS,
  ORG_SIZE_MULTIPLIERS,
  RECOVERY_STRATEGY_COSTS,
  STRATEGY_RISK_REDUCTION,
  SUPPORTED_CURRENCIES,
  type OrganizationSizeCategory,
  type RecoveryStrategyKey,
  type SupportedCurrency,
} from '../constants/market-financial-data.js';
import { CurrencyService } from './currency.service.js';
import {
  calculateRecommendationRoi,
  estimateServiceMonthlyProductionCost,
  estimateStrategyMonthlyDrCost,
  isBusinessProfileConfigured,
  resolveIncidentProbabilityForNodeType,
  strategyTargetRtoMinutes,
} from './company-financial-profile.service.js';

export type FinancialConfidence = 'user_defined' | 'estimated' | 'low_confidence';

export type FinancialNodeInput = {
  id: string;
  name: string;
  type: string;
  provider?: string | null;
  region?: string | null;
  metadata?: unknown;
  estimatedMonthlyCost?: number | null;
  estimatedMonthlyCostCurrency?: string | null;
  estimatedMonthlyCostSource?: string | null;
  estimatedMonthlyCostConfidence?: number | null;
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
  currentRtoMinutes?: number;
  targetRtoMinutes?: number;
  targetRpoMinutes?: number;
  incidentProbabilityAnnual?: number;
  incidentType?: string;
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
  mode?: 'infra_only' | 'business_profile' | null;
  sizeCategory?: string | null;
  verticalSector?: string | null;
  industrySector?: string | null;
  employeeCount?: number | null;
  annualRevenue?: number | null;
  customDowntimeCostPerHour?: number | null;
  hourlyDowntimeCost?: number | null;
  isConfigured?: boolean | null;
  annualITBudget?: number | null;
  drBudgetPercent?: number | null;
  customCurrency?: string | null;
  strongholdPlanId?: string | null;
  strongholdMonthlyCost?: number | null;
  numberOfCustomers?: number | null;
  criticalBusinessHours?: {
    start: string;
    end: string;
    timezone: string;
  } | null;
  regulatoryConstraints?: string[] | null;
  serviceOverrides?: Array<{
    nodeId: string;
    customDowntimeCostPerHour?: number;
    customCriticalityTier?: 'critical' | 'high' | 'medium' | 'low';
  }> | null;
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
    recoveryTier?: number;
    ale: number;
    probability: number;
    estimatedDowntimeHours: number;
    costPerHour: number;
    dependentsCount: number;
    costMethod?: string;
    costConfidence?: string;
    fallbackEstimate?: number | null;
    monthlyCost?: number;
    monthlyCostSource?: string;
    monthlyCostSourceLabel?: string;
    pricingConfidence?: number;
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
  roiPercent: number | null;
  roiStatus: 'strongly_recommended' | 'rentable' | 'cost_exceeds_avoided_risk' | 'non_applicable';
  roiMessage: string;
  paybackMonths: number | null;
  paybackLabel: string;
  strongholdSubscriptionAnnual: number;
  breakdownByRecommendation: Array<{
    recommendationId: string;
    strategy: string;
    targetNodes: string[];
    annualCost: number;
    currentALE: number;
    projectedALE: number;
    riskReduction: number;
    individualROI: number | null;
    roiStatus: 'strongly_recommended' | 'rentable' | 'cost_exceeds_avoided_risk' | 'non_applicable';
    roiMessage: string;
    paybackMonths: number | null;
    paybackLabel: string;
    formula: string;
    calculationInputs: {
      hourlyDowntimeCost: number;
      currentRtoHours: number;
      targetRtoHours: number;
      incidentProbabilityAnnual: number;
      monthlyDrCost: number;
    };
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
  monthlyCost: number;
  monthlyCostSource: string;
  monthlyCostSourceLabel: string;
  pricingConfidence: number;
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

type ExtendedRecoveryStrategyKey = RecoveryStrategyKey | 'hot_standby';

function normalizeRecoveryStrategy(
  rawStrategy: string | undefined,
  fallback: ExtendedRecoveryStrategyKey,
): ExtendedRecoveryStrategyKey {
  const normalized = (rawStrategy || '').toLowerCase().replace(/[-\s]/g, '_');
  if (normalized === 'hot_standby') return 'hot_standby';
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

function resolveProbability(node: FinancialNodeInput): {
  probability: number;
  rationale: string;
  source: string;
} {
  const isSPOF = Boolean(node.isSPOF);
  const criticality = normalizeCriticality(node.criticalityScore);
  const metadata =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {};
  const probabilityByType = resolveIncidentProbabilityForNodeType(
    node.type,
    undefined,
    metadata,
  );

  if (isSPOF) {
    return {
      probability: probabilityByType.probabilityAnnual,
      rationale: 'SPOF probability calibrated by workload type',
      source: probabilityByType.source,
    };
  }

  if (criticality > 0.85) {
    return {
      probability: Math.max(0.01, probabilityByType.probabilityAnnual * 0.25),
      rationale: 'Residual risk on non-SPOF critical component',
      source: `Derived from ${probabilityByType.source}`,
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
): ExtendedRecoveryStrategyKey {
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
  if (recommendation.priority === 'P0' && hasStatefulCriticalType) return 'hot_standby';
  if (hasStatefulCriticalType) return 'warm_standby';
  return 'pilot_light';
}

function strategyAnnualCost(
  strategy: ExtendedRecoveryStrategyKey,
  targetNodes: string[],
  nodeLookup: Map<string, FinancialNodeInput>,
  currency: SupportedCurrency,
): number {
  const fallbackMonthlyProduction = 50;
  const scopedTargets = targetNodes.length > 0 ? targetNodes : ['__fallback__'];
  const monthlyTotal = scopedTargets.reduce((sum, nodeId) => {
    const node = nodeLookup.get(nodeId);
    const estimatedMonthlyProduction =
      node && node.estimatedMonthlyCost && node.estimatedMonthlyCost > 0
        ? node.estimatedMonthlyCost
        : node
          ? estimateServiceMonthlyProductionCost(
              {
                type: node.type,
                provider: node.provider ?? null,
                metadata: node.metadata,
                criticalityScore: node.criticalityScore ?? null,
                impactCategory: node.impactCategory ?? null,
              },
              currency,
            ).estimatedMonthlyCost
          : fallbackMonthlyProduction;
    return (
      sum +
      estimateStrategyMonthlyDrCost(
        estimatedMonthlyProduction,
        strategy as Parameters<typeof estimateStrategyMonthlyDrCost>[1],
        {
        nodeType: node?.type,
        provider: node?.provider,
        metadata: node?.metadata,
      },
      )
    );
  }, 0);
  return roundAmount(monthlyTotal * 12);
}

function strategyRiskReductionFactor(strategy: ExtendedRecoveryStrategyKey): number {
  if (strategy === 'hot_standby') {
    return 0.88;
  }

  if (strategy in STRATEGY_RISK_REDUCTION) {
    return STRATEGY_RISK_REDUCTION[strategy as RecoveryStrategyKey];
  }

  return 0.6;
}

function classifyGlobalRoi(
  roiPercent: number | null,
  riskReductionAmount: number,
  annualRemediationCost: number,
): { status: ROIResult['roiStatus']; message: string } {
  if (riskReductionAmount <= 0 || roiPercent == null) {
    return { status: 'non_applicable', message: 'Non applicable' };
  }
  if (riskReductionAmount <= annualRemediationCost || roiPercent < 0) {
    return {
      status: 'cost_exceeds_avoided_risk',
      message: 'Cout superieur au risque evite',
    };
  }
  if (roiPercent > 100) {
    return {
      status: 'strongly_recommended',
      message: 'Fortement recommande',
    };
  }
  return {
    status: 'rentable',
    message: 'Rentable',
  };
}

function computeRoiPercent(riskReductionAmount: number, annualRemediationCost: number): number | null {
  if (!(annualRemediationCost > 0) || !Number.isFinite(annualRemediationCost)) return null;
  if (!Number.isFinite(riskReductionAmount) || riskReductionAmount <= 0) return null;
  return Number((((riskReductionAmount - annualRemediationCost) / annualRemediationCost) * 100).toFixed(2));
}

function computePaybackMonths(riskReductionAmount: number, annualRemediationCost: number): number | null {
  if (!(annualRemediationCost > 0) || !(riskReductionAmount > 0)) return null;
  const months = annualRemediationCost / (riskReductionAmount / 12);
  if (!Number.isFinite(months) || months <= 0) return null;
  return Number(months.toFixed(2));
}

function classifyPaybackLabel(paybackMonths: number | null): string {
  if (paybackMonths == null || !Number.isFinite(paybackMonths) || paybackMonths <= 0) {
    return 'Non rentable';
  }
  if (paybackMonths > 60) return '> 60 mois';
  if (paybackMonths < 6) return 'Quick win';
  if (paybackMonths <= 24) return 'Rentable a moyen terme';
  return 'Investissement long terme';
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

function hasConfiguredFinancialProfile(
  profile: FinancialOrganizationProfileInput,
): boolean {
  const annualRevenue = Number(profile.annualRevenue || 0);
  const hourlyDowntime = Number(profile.customDowntimeCostPerHour || profile.hourlyDowntimeCost || 0);
  const mode = String(profile.mode || '').toLowerCase();
  const isConfigured = annualRevenue > 0 && hourlyDowntime > 0;
  if (typeof profile.isConfigured === 'boolean') {
    return profile.isConfigured && isConfigured;
  }
  if (mode === 'business_profile') return isConfigured;
  return isConfigured;
}

function pricingSourceLabelFromKey(source: string): string {
  if (source === 'cost-explorer') return '[Prix reel ✓✓]';
  if (source === 'pricing-api') return '[Prix API ✓]';
  return '[Estimation ≈]';
}

function parseNodePricingSource(source: string | null | undefined): {
  sourceKey: string;
  sourceLabel: string;
} {
  const raw = String(source || '').trim().toLowerCase();
  if (raw.startsWith('budget_profile_calibration:')) {
    const inherited = raw.split(':')[1] || 'static-table';
    return {
      sourceKey: inherited,
      sourceLabel: pricingSourceLabelFromKey(inherited),
    };
  }
  if (raw === 'cost-explorer' || raw === 'pricing-api' || raw === 'static-table') {
    return {
      sourceKey: raw,
      sourceLabel: pricingSourceLabelFromKey(raw),
    };
  }
  return {
    sourceKey: raw || 'static-table',
    sourceLabel: pricingSourceLabelFromKey(raw || 'static-table'),
  };
}

function replacementRestorationMonths(nodeType: string): number {
  const normalized = String(nodeType || '').toUpperCase();
  if (normalized === 'DATABASE') return 0.04;
  if (normalized === 'CACHE') return 0.02;
  if (
    normalized === 'VM' ||
    normalized === 'PHYSICAL_SERVER' ||
    normalized === 'APPLICATION' ||
    normalized === 'MICROSERVICE' ||
    normalized === 'CONTAINER' ||
    normalized === 'KUBERNETES_POD' ||
    normalized === 'KUBERNETES_SERVICE' ||
    normalized === 'KUBERNETES_CLUSTER'
  ) {
    return 0.02;
  }
  return 0.01;
}

function businessMttrHours(nodeType: string): number {
  const normalized = String(nodeType || '').toUpperCase();
  if (normalized === 'DATABASE') return 6;
  if (normalized === 'CACHE') return 1.5;
  if (
    normalized === 'VM' ||
    normalized === 'PHYSICAL_SERVER' ||
    normalized === 'APPLICATION' ||
    normalized === 'MICROSERVICE' ||
    normalized === 'CONTAINER' ||
    normalized === 'KUBERNETES_POD' ||
    normalized === 'KUBERNETES_SERVICE' ||
    normalized === 'KUBERNETES_CLUSTER'
  ) {
    return 3;
  }
  return 0.75;
}

function resolveNodeMonthlyCostEstimate(
  node: FinancialNodeInput,
  currency: SupportedCurrency,
): {
  monthlyCost: number;
  sourceKey: string;
  sourceLabel: string;
  confidence: number;
  sourceReference: string;
} {
  const storedMonthlyCost = Number(node.estimatedMonthlyCost);
  if (Number.isFinite(storedMonthlyCost) && storedMonthlyCost > 0) {
    const parsedSource = parseNodePricingSource(node.estimatedMonthlyCostSource);
    const storedCurrency = normalizeCurrency(node.estimatedMonthlyCostCurrency);
    const convertedMonthlyCost =
      storedCurrency === currency
        ? storedMonthlyCost
        : CurrencyService.convertAmount(storedMonthlyCost, storedCurrency, currency);
    return {
      monthlyCost: convertedMonthlyCost,
      sourceKey: parsedSource.sourceKey,
      sourceLabel: parsedSource.sourceLabel,
      confidence: Number.isFinite(Number(node.estimatedMonthlyCostConfidence))
        ? Number(node.estimatedMonthlyCostConfidence)
        : 0.75,
      sourceReference: `Infra node cached pricing (${parsedSource.sourceKey})`,
    };
  }

  const estimate = estimateServiceMonthlyProductionCost(
    {
      type: node.type,
      provider: node.provider ?? null,
      metadata: node.metadata,
      criticalityScore: node.criticalityScore ?? null,
      impactCategory: node.impactCategory ?? null,
    },
    currency,
  );
  return {
    monthlyCost: estimate.estimatedMonthlyCost,
    sourceKey: estimate.pricingSource,
    sourceLabel: estimate.pricingSourceLabel,
    confidence: estimate.confidence,
    sourceReference: estimate.sourceReference,
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
  const currency = normalizeCurrency(orgProfile.customCurrency);
  const useBusinessProfile = hasConfiguredFinancialProfile(orgProfile);
  const organizationDowntimeCost = Number(
    orgProfile.customDowntimeCostPerHour || orgProfile.hourlyDowntimeCost || 0,
  );

  const losses: InternalNodeLoss[] = [];
  const sources: string[] = [];

  for (const node of analysisResult.nodes || []) {
    const probabilityRule = resolveProbability(node);
    if (probabilityRule.probability <= 0) continue;

    const resolvedCost = resolvedNodeCostsByNodeId[node.id];
    const resolvedCostPerHour =
      resolvedCost && Number.isFinite(resolvedCost.costPerHour) && resolvedCost.costPerHour > 0
        ? roundAmount(resolvedCost.costPerHour)
        : null;
    const nodeOverrideCost = Number(overridesByNodeId[node.id]?.customCostPerHour || 0);
    const monthlyCostEstimate = resolveNodeMonthlyCostEstimate(node, currency);
    const restorationMonths = replacementRestorationMonths(node.type);
    const infraDowntimeHours = Number((restorationMonths * 730).toFixed(2));
    const infraSingleLossExpectancy = monthlyCostEstimate.monthlyCost * restorationMonths;

    let downtimeHours = infraDowntimeHours;
    let costPerHour =
      infraDowntimeHours > 0
        ? infraSingleLossExpectancy / infraDowntimeHours
        : infraSingleLossExpectancy;
    let singleLossExpectancy = infraSingleLossExpectancy;
    let costMethod = 'infra_replacement_cost';
    let costConfidence = String(monthlyCostEstimate.confidence.toFixed(2));

    if (useBusinessProfile) {
      const businessCostPerHour =
        resolvedCostPerHour ??
        (nodeOverrideCost > 0 ? roundAmount(nodeOverrideCost) : null) ??
        (organizationDowntimeCost > 0 ? roundAmount(organizationDowntimeCost) : null) ??
        0;
      downtimeHours = businessMttrHours(node.type);
      costPerHour = businessCostPerHour;
      singleLossExpectancy = businessCostPerHour * downtimeHours;
      costMethod =
        resolvedCost?.method ??
        (nodeOverrideCost > 0 ? 'user_override' : 'business_profile');
      costConfidence = String(
        resolvedCost?.confidence ??
          (nodeOverrideCost > 0 ? 'user_defined' : 'profile'),
      );
    }

    if (!Number.isFinite(singleLossExpectancy) || singleLossExpectancy < 0) {
      singleLossExpectancy = 0;
    }
    const fallbackEstimate = resolvedCost?.fallbackEstimate ?? null;
    const recoveryTier = getTierFromNode(node, processMap);
    const ale = probabilityRule.probability * singleLossExpectancy;
    const normalizedCostPerHour =
      downtimeHours > 0 ? roundAmount(singleLossExpectancy / downtimeHours) : roundAmount(costPerHour);

    losses.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      isSPOF: Boolean(node.isSPOF),
      recoveryTier,
      probability: probabilityRule.probability,
      estimatedDowntimeHours: downtimeHours,
      costPerHour: normalizedCostPerHour,
      dependentsCount: countDependents(node),
      ale,
      costMethod,
      costConfidence,
      fallbackEstimate,
      monthlyCost: roundAmount(monthlyCostEstimate.monthlyCost),
      monthlyCostSource: monthlyCostEstimate.sourceKey,
      monthlyCostSourceLabel: monthlyCostEstimate.sourceLabel,
      pricingConfidence: monthlyCostEstimate.confidence,
    });

    sources.push(
      probabilityRule.source,
      ...(resolvedCost?.sources || []),
      monthlyCostEstimate.sourceReference,
      useBusinessProfile
        ? 'Business profile (manual) + service MTTR model'
        : 'Infrastructure replacement-cost model',
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
    const dependentsCount = Math.max(1, countDependents(node));
    const nodeType = String(node.type || 'APPLICATION').toUpperCase();
    const organizationDowntimeCost = Number(
      profile.customDowntimeCostPerHour || profile.hourlyDowntimeCost || 0,
    );

    if (override?.customCostPerHour && override.customCostPerHour > 0) {
      return {
        estimatedCostPerHour: roundAmount(override.customCostPerHour),
        confidence: 'user_defined',
        breakdown: {
          nodeType,
          typeMultiplier: 0,
          dependentsCount,
          orgSizeMultiplier: ORG_SIZE_MULTIPLIERS[sizeCategory],
          baseCost: 0,
          verticalAdjustedCost: null,
          organizationOverrideAdjustedCost: null,
          finalCost: roundAmount(override.customCostPerHour),
          currency,
        },
        sources: [
          'User-defined node override',
          'Validated by tenant input',
        ],
      };
    }

    if (hasConfiguredFinancialProfile(profile) && organizationDowntimeCost > 0) {
      return {
        estimatedCostPerHour: roundAmount(organizationDowntimeCost),
        confidence: 'user_defined',
        breakdown: {
          nodeType,
          typeMultiplier: 0,
          dependentsCount,
          orgSizeMultiplier: ORG_SIZE_MULTIPLIERS[sizeCategory],
          baseCost: 0,
          verticalAdjustedCost: null,
          organizationOverrideAdjustedCost: roundAmount(organizationDowntimeCost),
          finalCost: roundAmount(organizationDowntimeCost),
          currency,
        },
        sources: ['Global downtime cost from manually configured financial profile'],
      };
    }

    return {
      estimatedCostPerHour: 0,
      confidence: 'low_confidence',
      breakdown: {
        nodeType,
        typeMultiplier: 0,
        dependentsCount,
        orgSizeMultiplier: ORG_SIZE_MULTIPLIERS[sizeCategory],
        baseCost: 0,
        verticalAdjustedCost: null,
        organizationOverrideAdjustedCost: null,
        finalCost: 0,
        currency,
      },
      sources: [
        'Business impact not configured. Financial profile required (annual revenue + downtime cost/hour).',
      ],
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
          recoveryTier: loss.recoveryTier,
          ale: roundAmount(loss.ale),
          probability: loss.probability,
          estimatedDowntimeHours: Number(loss.estimatedDowntimeHours.toFixed(2)),
          costPerHour: roundAmount(loss.costPerHour),
          dependentsCount: loss.dependentsCount,
          costMethod: loss.costMethod,
          costConfidence: loss.costConfidence,
          fallbackEstimate: loss.fallbackEstimate,
          monthlyCost: roundAmount(loss.monthlyCost),
          monthlyCostSource: loss.monthlyCostSource,
          monthlyCostSourceLabel: loss.monthlyCostSourceLabel,
          pricingConfidence: Number(loss.pricingConfidence.toFixed(2)),
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
    const useBusinessProfile = hasConfiguredFinancialProfile(profile);

    const { losses, sources } = buildNodeLossContributions(
      analysisResult,
      biaResult,
      profile,
      overridesByNodeId,
      resolvedNodeCostsByNodeId,
    );

    const nodeLookup = new Map((analysisResult.nodes || []).map((node) => [node.id, node]));
    const nodeLossById = new Map(losses.map((loss) => [loss.nodeId, loss]));
    // Keep ROI anchored to the exact ALE baseline used by the dashboard (same nodes, same costs, same probabilities).
    const baselineCurrentALE = roundAmount(
      losses.reduce((sum, loss) => sum + (Number.isFinite(loss.ale) ? loss.ale : 0), 0),
    );
    // Track best projected ALE per node to avoid double-counting savings when recommendations overlap.
    const projectedAleByNodeId = new Map(
      losses.map((loss) => [loss.nodeId, Number.isFinite(loss.ale) ? loss.ale : 0]),
    );
    const processMap = new Map(
      (biaResult.processes || []).map((process) => [process.serviceNodeId, process]),
    );
    const companyHourlyDowntimeCost =
      Number(profile.customDowntimeCostPerHour) > 0
        ? Number(profile.customDowntimeCostPerHour)
        : Number(profile.hourlyDowntimeCost) > 0
          ? Number(profile.hourlyDowntimeCost)
          : losses.length > 0
            ? losses.reduce((sum, loss) => sum + loss.costPerHour, 0) / losses.length
            : 1_500;

    const breakdownByRecommendation: ROIResult['breakdownByRecommendation'] = [];

    let remediationCostTotal = 0;

    for (const recommendation of recommendations || []) {
      const targetNodes = recommendationTargetNodes(recommendation);
      const strategy = recommendationDefaultStrategy(recommendation, nodeLookup);

      const annualCost = roundAmount(
        recommendation.annualCost && recommendation.annualCost > 0
          ? recommendation.annualCost
          : recommendation.monthlyCost && recommendation.monthlyCost > 0
            ? recommendation.monthlyCost * 12
          : strategyAnnualCost(strategy, targetNodes, nodeLookup, currency),
      );

      const targetRtoMinutes =
        Number.isFinite(recommendation.targetRtoMinutes) &&
        Number(recommendation.targetRtoMinutes) > 0
          ? Number(recommendation.targetRtoMinutes)
          : strategyTargetRtoMinutes(strategy as any);
      const infraReductionFactor = strategyRiskReductionFactor(strategy);

      let recommendationCurrentAle = 0;
      let recommendationProjectedAle = 0;
      const probabilityValues: number[] = [];
      const currentRtoValues: number[] = [];
      const hourlyCostValues: number[] = [];

      for (const nodeId of targetNodes) {
        const node = nodeLookup.get(nodeId);
        const nodeLoss = nodeLossById.get(nodeId);
        if (!node || !nodeLoss) continue;

        const probability =
          Number.isFinite(recommendation.incidentProbabilityAnnual) &&
          Number(recommendation.incidentProbabilityAnnual) > 0
            ? Number(recommendation.incidentProbabilityAnnual)
            : nodeLoss.probability;
        const hourlyDowntimeCost =
          Number.isFinite(nodeLoss.costPerHour) && nodeLoss.costPerHour > 0
            ? nodeLoss.costPerHour
            : companyHourlyDowntimeCost;

        let currentAleNode = Number.isFinite(nodeLoss.ale) && nodeLoss.ale > 0 ? nodeLoss.ale : 0;
        let projectedAleNode = currentAleNode;
        let currentRtoHours = Math.max(0.01, nodeLoss.estimatedDowntimeHours);

        if (useBusinessProfile) {
          const currentRtoMinutes =
            Number.isFinite(recommendation.currentRtoMinutes) &&
            Number(recommendation.currentRtoMinutes) > 0
              ? Number(recommendation.currentRtoMinutes)
              : Math.max(1, Math.round(getRtoHours(node, processMap) * 60));

          currentAleNode =
            Number.isFinite(nodeLoss.ale) && nodeLoss.ale > 0
              ? nodeLoss.ale
              : hourlyDowntimeCost * (currentRtoMinutes / 60) * probability;
          projectedAleNode = Math.min(
            currentAleNode,
            hourlyDowntimeCost * (targetRtoMinutes / 60) * probability,
          );
          currentRtoHours = currentRtoMinutes / 60;
        } else {
          if (!(currentAleNode > 0)) {
            currentAleNode = hourlyDowntimeCost * currentRtoHours * probability;
          }
          projectedAleNode = Math.max(0, currentAleNode * (1 - infraReductionFactor));
        }

        recommendationCurrentAle += currentAleNode;
        recommendationProjectedAle += projectedAleNode;
        probabilityValues.push(probability);
        currentRtoValues.push(currentRtoHours);
        hourlyCostValues.push(hourlyDowntimeCost);

        const currentProjected = projectedAleByNodeId.get(nodeId);
        if (Number.isFinite(currentProjected as number)) {
          projectedAleByNodeId.set(nodeId, Math.min(currentProjected as number, projectedAleNode));
        } else {
          projectedAleByNodeId.set(nodeId, projectedAleNode);
        }
      }

      const recommendationRiskReduction = recommendationCurrentAle - recommendationProjectedAle;
      if (recommendationProjectedAle >= recommendationCurrentAle || recommendationRiskReduction <= 0) {
        appLogger.warn('financial.roi.recommendation_skipped_non_improving', {
          recommendationId:
            recommendation.recommendationId ||
            recommendation.id ||
            `rec-${breakdownByRecommendation.length + 1}`,
          strategy,
          targetNodes,
          aleBefore: roundAmount(recommendationCurrentAle),
          aleAfter: roundAmount(recommendationProjectedAle),
          riskAvoided: roundAmount(recommendationRiskReduction),
        });
        continue;
      }

      remediationCostTotal += annualCost;
      const avgHourlyDowntimeCost =
        hourlyCostValues.length > 0
          ? hourlyCostValues.reduce((sum, value) => sum + value, 0) / hourlyCostValues.length
          : companyHourlyDowntimeCost;
      const avgCurrentRtoHours =
        currentRtoValues.length > 0
          ? currentRtoValues.reduce((sum, value) => sum + value, 0) / currentRtoValues.length
          : targetRtoMinutes / 60;
      const avgProbability =
        probabilityValues.length > 0
          ? probabilityValues.reduce((sum, value) => sum + value, 0) / probabilityValues.length
          : resolveIncidentProbabilityForNodeType('APPLICATION').probabilityAnnual;
      const roiCalcInputs = {
        hourlyDowntimeCost: roundAmount(avgHourlyDowntimeCost),
        currentRtoHours: Number(avgCurrentRtoHours.toFixed(2)),
        targetRtoHours: Number(
          (
            useBusinessProfile
              ? targetRtoMinutes / 60
              : avgCurrentRtoHours * (1 - infraReductionFactor)
          ).toFixed(2),
        ),
        incidentProbabilityAnnual: Number(avgProbability.toFixed(4)),
        monthlyDrCost: roundAmount(annualCost / 12),
      };
      const roiCalc = calculateRecommendationRoi({
        hourlyDowntimeCost: avgHourlyDowntimeCost,
        currentRtoMinutes: Math.max(0, roiCalcInputs.currentRtoHours * 60),
        targetRtoMinutes: Math.max(0, roiCalcInputs.targetRtoHours * 60),
        incidentProbabilityAnnual: avgProbability,
        monthlyDrCost: annualCost / 12,
      });
      const individualROI = computeRoiPercent(recommendationRiskReduction, annualCost);
      let paybackMonths = computePaybackMonths(recommendationRiskReduction, annualCost);
      let paybackLabel = classifyPaybackLabel(paybackMonths);
      if (individualROI != null && individualROI > 0 && paybackLabel === 'Non rentable') {
        appLogger.error('financial.roi.payback_inconsistency_recommendation', {
          recommendationId: recommendation.recommendationId || recommendation.id || 'unknown',
          individualROI,
          recommendationRiskReduction: roundAmount(recommendationRiskReduction),
          annualCost: roundAmount(annualCost),
        });
        paybackMonths = computePaybackMonths(recommendationRiskReduction, annualCost);
        paybackLabel = classifyPaybackLabel(paybackMonths);
      }
      if (individualROI != null && individualROI < 0 && paybackMonths != null) {
        paybackMonths = null;
        paybackLabel = 'Non rentable';
      }
      const classification = classifyGlobalRoi(
        individualROI,
        recommendationRiskReduction,
        annualCost,
      );

      breakdownByRecommendation.push({
        recommendationId:
          recommendation.recommendationId || recommendation.id || `rec-${breakdownByRecommendation.length + 1}`,
        strategy,
        targetNodes,
        annualCost: roundAmount(annualCost),
        currentALE: roundAmount(recommendationCurrentAle),
        projectedALE: roundAmount(recommendationProjectedAle),
        riskReduction: roundAmount(recommendationRiskReduction),
        individualROI,
        roiStatus: classification.status,
        roiMessage: classification.message,
        paybackMonths,
        paybackLabel,
        formula: useBusinessProfile
          ? 'ALE = downtimeCostPerHour x MTTR(hours) x annualIncidentProbability; ROI = ((riskAvoided - annualDrCost) / annualDrCost) x 100'
          : 'ALE_infra = annualIncidentProbability x replacementCost; riskAvoided = ALE_infra x strategyRiskReduction; ROI = ((riskAvoided - annualDrCost) / annualDrCost) x 100',
        calculationInputs: useBusinessProfile ? roiCalc.inputs : roiCalcInputs,
      });
    }

    const strongholdSubscriptionAnnual = roundAmount(
      profile.strongholdMonthlyCost && profile.strongholdMonthlyCost > 0
        ? profile.strongholdMonthlyCost * 12
        : (STRONGHOLD_PLAN_MONTHLY_COST[String(profile.strongholdPlanId || 'PRO').toUpperCase()] ??
            STRONGHOLD_PLAN_MONTHLY_COST.PRO ??
            800) * 12,
    );

    const annualRemediationCost = roundAmount(remediationCostTotal);
    const currentALE = roundAmount(baselineCurrentALE);
    const projectedALE = roundAmount(
      Array.from(projectedAleByNodeId.values()).reduce((sum, value) => sum + value, 0),
    );
    let riskReductionAmount = roundAmount(currentALE - projectedALE);
    if (riskReductionAmount < 0) {
      riskReductionAmount = 0;
    }
    if (riskReductionAmount > currentALE) {
      appLogger.error('financial.roi.inconsistent_risk_reduction_exceeds_annual_risk', {
        currentALE,
        projectedALE,
        riskReductionAmount,
      });
      riskReductionAmount = currentALE;
    }
    const riskReduction = currentALE > 0 ? (riskReductionAmount / currentALE) * 100 : 0;
    const netAnnualSavings = roundAmount(riskReductionAmount - annualRemediationCost);
    const roiPercent = computeRoiPercent(riskReductionAmount, annualRemediationCost);
    let paybackMonths = computePaybackMonths(riskReductionAmount, annualRemediationCost);
    let paybackLabel = classifyPaybackLabel(paybackMonths);
    if (roiPercent != null && roiPercent > 0 && paybackLabel === 'Non rentable') {
      appLogger.error('financial.roi.payback_inconsistency_global', {
        roiPercent,
        riskReductionAmount,
        annualRemediationCost,
      });
      paybackMonths = computePaybackMonths(riskReductionAmount, annualRemediationCost);
      paybackLabel = classifyPaybackLabel(paybackMonths);
    }
    if (roiPercent != null && roiPercent < 0 && paybackMonths != null) {
      paybackMonths = null;
      paybackLabel = 'Non rentable';
    }
    const globalClassification = classifyGlobalRoi(
      roiPercent,
      riskReductionAmount,
      annualRemediationCost,
    );

    return {
      currentALE: roundAmount(currentALE),
      projectedALE: roundAmount(projectedALE),
      riskReduction: Number(riskReduction.toFixed(2)),
      riskReductionAmount: roundAmount(riskReductionAmount),
      annualRemediationCost,
      netAnnualSavings,
      roiPercent,
      roiStatus: globalClassification.status,
      roiMessage: globalClassification.message,
      paybackMonths,
      paybackLabel,
      strongholdSubscriptionAnnual,
      breakdownByRecommendation,
      methodology: useBusinessProfile
        ? 'ALE_current = downtimeCostPerHour x MTTR_current(h) x annualIncidentProbability; ALE_after = downtimeCostPerHour x MTTR_target(h) x annualIncidentProbability; ROI = ((riskAvoided - annualDrCost) / annualDrCost) x 100.'
        : 'ALE_infra = annualIncidentProbability x replacementCost (monthlyCost x restorationTimeMonths). Projected ALE applies strategy risk reduction factors per recommendation.',
      sources: dedupeSources(sources, [
        'Probabilites estimees a partir des rapports Uptime Institute 2024, ITIC 2024, et IBM Cost of Data Breach 2024',
        RECOVERY_STRATEGY_COSTS.active_active.source,
        DOWNTIME_COST_BENCHMARKS.globalStats.uptimeSource,
        useBusinessProfile
          ? 'Business profile values provided manually by the organization'
          : 'Strategy risk reduction matrix (active_active 95%, warm_standby 80%, pilot_light 60%, backup_restore 40%)',
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
      0;

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


