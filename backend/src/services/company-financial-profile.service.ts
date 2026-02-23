import type { OrganizationProfile, PrismaClient } from '@prisma/client';
import type { SupportedCurrency } from '../constants/market-financial-data.js';
import { SUPPORTED_CURRENCIES } from '../constants/market-financial-data.js';
import {
  DEFAULT_CURRENCY,
  DEFAULT_DR_BUDGET_PERCENT,
  DOWNTIME_MEDIAN_BY_EMPLOYEE_SIZE,
  DR_FINANCIAL_SOURCES,
  DR_STRATEGY_PROFILES,
  INCIDENT_PROBABILITIES,
  INFRA_SIZE_HEURISTICS,
  IT_BUDGET_PERCENT_BY_SECTOR,
  RESOURCE_MONTHLY_COST_REFERENCES,
  type CostSourceKey,
  type DrStrategyKey,
  type IncidentProbabilityKey,
  type ProfileValueSourceKey,
} from '../constants/dr-financial-reference-data.js';
import { CurrencyService } from './currency.service.js';

export type CompanyFinancialProfileSource = 'user_input' | 'inferred' | 'hybrid';

export type FinancialFieldTrace = {
  source: ProfileValueSourceKey;
  confidence: number;
  note: string;
};

export type ResolvedCompanyFinancialProfile = {
  tenantId: string;
  source: CompanyFinancialProfileSource;
  confidence: number;
  annualRevenue: number | null;
  employeeCount: number | null;
  industrySector: string | null;
  annualITBudget: number | null;
  drBudgetPercent: number | null;
  hourlyDowntimeCost: number;
  currency: SupportedCurrency;
  estimatedDrBudgetAnnual: number | null;
  fieldSources: Record<string, FinancialFieldTrace>;
  sourceDisclaimer: string;
  inferenceBanner: string | null;
  sizeCategory: string;
  verticalSector: string | null;
  customDowntimeCostPerHour: number | null;
  customCurrency: SupportedCurrency;
  strongholdPlanId: string | null;
  strongholdMonthlyCost: number | null;
  isConfigured: boolean;
};

export type ServiceMonthlyCostEstimate = {
  estimatedMonthlyCost: number;
  costSource: CostSourceKey;
  confidence: number;
  currency: SupportedCurrency;
  note: string;
  sourceReference: string;
};

export type StrategySelectionResult = {
  strategy: DrStrategyKey;
  monthlyDrCost: number;
  annualDrCost: number;
  budgetWarning: string | null;
  strategySource: 'recommended' | 'user_override' | 'budget_adjusted';
  rationale: string[];
};

export type RecommendationRoiResult = {
  aleCurrent: number;
  aleAfter: number;
  riskAvoidedAnnual: number;
  annualDrCost: number;
  roiPercent: number | null;
  roiStatus:
    | 'strongly_recommended'
    | 'rentable'
    | 'cost_exceeds_avoided_risk'
    | 'non_applicable';
  roiMessage: string;
  paybackMonths: number | null;
  paybackLabel: string;
  formula: string;
  inputs: {
    hourlyDowntimeCost: number;
    currentRtoHours: number;
    targetRtoHours: number;
    incidentProbabilityAnnual: number;
    monthlyDrCost: number;
  };
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function normalizeCurrency(value: unknown): SupportedCurrency {
  if (typeof value === 'string') {
    const normalized = value.toUpperCase();
    if ((SUPPORTED_CURRENCIES as readonly string[]).includes(normalized)) {
      return normalized as SupportedCurrency;
    }
  }
  return DEFAULT_CURRENCY;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeSector(rawValue: unknown): string | null {
  if (typeof rawValue !== 'string') return null;
  const value = rawValue.trim().toLowerCase();
  if (!value) return null;
  if (value === 'tech') return 'technology';
  if (value === 'services') return 'services';
  if (value === 'public') return 'public';
  return value;
}

function extractBiaHourlyCost(financialImpact: unknown): number | null {
  if (!financialImpact || typeof financialImpact !== 'object' || Array.isArray(financialImpact)) {
    return null;
  }
  const payload = financialImpact as Record<string, unknown>;
  return (
    toPositiveNumber(payload.estimatedCostPerHour) ??
    toPositiveNumber(payload.hourlyDowntimeCost) ??
    toPositiveNumber(payload.totalCostPerHour)
  );
}

function pickInfraHeuristic(nodeCount: number) {
  const matched = INFRA_SIZE_HEURISTICS.find(
    (item) => nodeCount >= item.minNodes && nodeCount <= item.maxNodes,
  );
  if (matched) return matched;

  const fallback = INFRA_SIZE_HEURISTICS[INFRA_SIZE_HEURISTICS.length - 1];
  if (fallback) return fallback;

  return {
    minNodes: 0,
    maxNodes: Number.MAX_SAFE_INTEGER,
    sizeLabel: 'sme_mid',
    inferredEmployees: 200,
    inferredAnnualRevenue: 20_000_000,
    confidence: 0.35,
  } as const;
}

function inferDowntimeMedianFromEmployees(employeeCount: number | null): number {
  const employees = employeeCount && employeeCount > 0 ? employeeCount : 250;
  const bucket =
    DOWNTIME_MEDIAN_BY_EMPLOYEE_SIZE.find(
      (item) => employees >= item.minEmployees && employees <= item.maxEmployees,
    ) ??
    DOWNTIME_MEDIAN_BY_EMPLOYEE_SIZE[DOWNTIME_MEDIAN_BY_EMPLOYEE_SIZE.length - 1] ?? {
      minEmployees: 251,
      maxEmployees: 1_000,
      hourlyCost: 100_000,
    };
  return bucket.hourlyCost;
}

function inferCriticalityBucket(node: {
  criticalityScore?: number | null;
  impactCategory?: string | null;
}): 'critical' | 'high' | 'medium' | 'low' {
  const impact = String(node.impactCategory || '').toLowerCase();
  if (impact.includes('tier1') || impact.includes('critical') || impact.includes('mission')) {
    return 'critical';
  }
  if (impact.includes('tier2') || impact.includes('high') || impact.includes('business')) {
    return 'high';
  }
  if (impact.includes('tier3') || impact.includes('medium') || impact.includes('important')) {
    return 'medium';
  }

  const score = Number(node.criticalityScore);
  if (Number.isFinite(score)) {
    const normalized = score > 1 ? score / 100 : score;
    if (normalized >= 0.85) return 'critical';
    if (normalized >= 0.65) return 'high';
    if (normalized >= 0.45) return 'medium';
  }
  return 'low';
}

function inferInstanceSize(metadata: Record<string, unknown>): 'small' | 'medium' | 'large' {
  const instanceType = String(metadata.instanceType || metadata.flavor || '').toLowerCase();
  const cpu = Number(metadata.vcpu ?? metadata.cpu ?? metadata.cpuCount ?? 0);
  const memory = Number(metadata.memoryGb ?? metadata.memoryGB ?? metadata.memory ?? 0);

  if (
    instanceType.includes('2xlarge') ||
    instanceType.includes('4xlarge') ||
    instanceType.includes('8xlarge') ||
    cpu >= 8 ||
    memory >= 32
  ) {
    return 'large';
  }
  if (
    instanceType.includes('xlarge') ||
    instanceType.includes('.large') ||
    cpu >= 4 ||
    memory >= 8
  ) {
    return 'medium';
  }
  return 'small';
}

function midpoint(min: number, max: number): number {
  return (min + max) / 2;
}

function classifyPaybackLabel(paybackMonths: number | null): string {
  if (paybackMonths == null || !Number.isFinite(paybackMonths) || paybackMonths <= 0 || paybackMonths > 60) {
    return 'Non rentable';
  }
  if (paybackMonths < 6) return 'Quick win';
  if (paybackMonths <= 24) return 'Rentable a moyen terme';
  return 'Investissement long terme';
}

function classifyRoiStatus(roiPercent: number | null, riskAvoidedAnnual: number, annualDrCost: number) {
  if (riskAvoidedAnnual <= 0 || roiPercent == null) {
    return {
      status: 'non_applicable' as const,
      message: 'Non applicable',
    };
  }
  if (riskAvoidedAnnual <= annualDrCost || roiPercent < 0) {
    return {
      status: 'cost_exceeds_avoided_risk' as const,
      message: 'Cout superieur au risque evite',
    };
  }
  if (roiPercent > 100) {
    return {
      status: 'strongly_recommended' as const,
      message: 'Fortement recommande',
    };
  }
  return {
    status: 'rentable' as const,
    message: 'Rentable',
  };
}

function listFieldSourceKinds(
  fieldSources: Record<string, FinancialFieldTrace>,
): Set<ProfileValueSourceKey> {
  return new Set(Object.values(fieldSources).map((trace) => trace.source));
}

function readPersistedFieldSources(
  profile: OrganizationProfile | null,
): Record<string, ProfileValueSourceKey> {
  if (!profile) return {};
  const metadata = profile.profileMetadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const rawFieldSources = (metadata as Record<string, unknown>).fieldSources;
  if (!rawFieldSources || typeof rawFieldSources !== 'object' || Array.isArray(rawFieldSources)) {
    return {};
  }

  const parsed: Record<string, ProfileValueSourceKey> = {};
  for (const [field, rawValue] of Object.entries(rawFieldSources)) {
    if (typeof rawValue !== 'string') continue;
    const normalized = rawValue.trim().toLowerCase();
    if (
      normalized === 'user_input' ||
      normalized === 'suggested' ||
      normalized === 'inferred' ||
      normalized === 'bia_validated' ||
      normalized === 'inferred_infrastructure' ||
      normalized === 'market_reference'
    ) {
      parsed[field] = normalized;
    }
  }

  return parsed;
}

function isExplicitlyConfigured(profile: OrganizationProfile | null): boolean {
  if (!profile) return false;
  return Boolean(
    toPositiveNumber(profile.customDowntimeCostPerHour) ||
      toPositiveNumber(profile.hourlyDowntimeCost) ||
      toPositiveNumber(profile.annualITBudget) ||
      toPositiveNumber(profile.annualRevenue) ||
      toPositiveNumber(profile.annualRevenueUSD) ||
      toPositiveNumber(profile.drBudgetPercent) ||
      toPositiveNumber(profile.employeeCount) ||
      (profile.industrySector && profile.industrySector.trim().length > 0),
  );
}

export async function resolveCompanyFinancialProfile(
  prismaClient: PrismaClient,
  tenantId: string,
  options?: {
    preferredCurrency?: unknown;
  },
): Promise<ResolvedCompanyFinancialProfile> {
  const [profile, latestBiaReport, nodeCount] = await Promise.all([
    prismaClient.organizationProfile.findUnique({ where: { tenantId } }),
    prismaClient.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        processes: {
          where: {
            validationStatus: 'validated',
          },
          select: {
            financialImpact: true,
          },
        },
      },
    }),
    prismaClient.infraNode.count({
      where: { tenantId },
    }),
  ]);

  const currency = normalizeCurrency(options?.preferredCurrency ?? profile?.customCurrency ?? DEFAULT_CURRENCY);
  const infraHeuristic = pickInfraHeuristic(nodeCount);
  const fieldSources: Record<string, FinancialFieldTrace> = {};
  const persistedFieldSources = readPersistedFieldSources(profile);

  const annualRevenueStored =
    toPositiveNumber(profile?.annualRevenue) ??
    (toPositiveNumber(profile?.annualRevenueUSD)
      ? CurrencyService.convertAmount(profile?.annualRevenueUSD as number, 'USD', currency)
      : null);
  const annualRevenueSourceHint =
    persistedFieldSources.annualRevenue ?? persistedFieldSources.annualRevenueUSD;
  const annualRevenue = annualRevenueStored
    ? roundMoney(annualRevenueStored)
    : roundMoney(CurrencyService.convertAmount(infraHeuristic.inferredAnnualRevenue, 'EUR', currency));
  fieldSources.annualRevenue = annualRevenueStored
    ? annualRevenueSourceHint === 'suggested'
      ? {
          source: 'suggested',
          confidence: 0.72,
          note: 'Valeur suggeree par profil de taille',
        }
      : annualRevenueSourceHint === 'inferred'
        ? {
            source: 'inferred',
            confidence: 0.6,
            note: 'Valeur inferee automatiquement',
          }
        : {
            source: 'user_input',
            confidence: 0.95,
            note: 'Valeur fournie manuellement',
          }
    : {
        source: 'inferred_infrastructure',
        confidence: infraHeuristic.confidence,
        note: `Inference par taille d infrastructure (${nodeCount} noeuds detectes)`,
      };

  const employeeCountStored = toPositiveNumber(profile?.employeeCount);
  const employeeCountSourceHint = persistedFieldSources.employeeCount;
  const employeeCount = employeeCountStored ? Math.round(employeeCountStored) : infraHeuristic.inferredEmployees;
  fieldSources.employeeCount = employeeCountStored
    ? employeeCountSourceHint === 'suggested'
      ? {
          source: 'suggested',
          confidence: 0.72,
          note: 'Valeur suggeree par profil de taille',
        }
      : employeeCountSourceHint === 'inferred'
        ? {
            source: 'inferred',
            confidence: 0.6,
            note: 'Valeur inferee automatiquement',
          }
        : {
            source: 'user_input',
            confidence: 0.95,
            note: 'Valeur fournie manuellement',
          }
    : {
        source: 'inferred_infrastructure',
        confidence: infraHeuristic.confidence,
        note: `Inference par taille d infrastructure (${nodeCount} noeuds detectes)`,
      };

  const industrySector = normalizeSector(profile?.industrySector ?? profile?.verticalSector) ?? null;
  const industrySourceHint = persistedFieldSources.industrySector ?? persistedFieldSources.verticalSector;
  fieldSources.industrySector = industrySector
    ? industrySourceHint === 'suggested'
      ? {
          source: 'suggested',
          confidence: 0.7,
          note: 'Secteur suggere automatiquement',
        }
      : industrySourceHint === 'inferred'
        ? {
            source: 'inferred',
            confidence: 0.55,
            note: 'Secteur infere automatiquement',
          }
        : {
            source: profile?.industrySector ? 'user_input' : 'inferred_infrastructure',
            confidence: profile?.industrySector ? 0.9 : 0.5,
            note: profile?.industrySector
              ? 'Secteur fourni manuellement'
              : 'Secteur derive de la configuration verticale',
          }
    : {
        source: 'market_reference',
        confidence: 0.35,
        note: 'Aucun secteur explicite: hypothese generaliste',
      };

  const annualItBudgetStored = toPositiveNumber(profile?.annualITBudget);
  const annualITBudgetSourceHint = persistedFieldSources.annualITBudget;
  const itBudgetSectorRatio = industrySector ? IT_BUDGET_PERCENT_BY_SECTOR[industrySector] : undefined;
  const annualITBudget = annualItBudgetStored
    ? roundMoney(annualItBudgetStored)
    : annualRevenue
      ? roundMoney(annualRevenue * (itBudgetSectorRatio ?? 0.05))
      : null;
  fieldSources.annualITBudget = annualItBudgetStored
    ? annualITBudgetSourceHint === 'suggested'
      ? {
          source: 'suggested',
          confidence: 0.72,
          note: 'Budget IT suggere automatiquement',
        }
      : annualITBudgetSourceHint === 'inferred'
        ? {
            source: 'inferred',
            confidence: 0.6,
            note: 'Budget IT infere automatiquement',
          }
        : {
            source: 'user_input',
            confidence: 0.95,
            note: 'Budget IT fourni manuellement',
          }
    : {
        source: 'inferred_infrastructure',
        confidence: 0.45,
        note: `Estimation a partir du CA et du secteur (${Math.round((itBudgetSectorRatio ?? 0.05) * 100)}%)`,
      };

  const drBudgetPercentStored = toPositiveNumber(profile?.drBudgetPercent);
  const drBudgetPercentSourceHint = persistedFieldSources.drBudgetPercent;
  const drBudgetPercent = drBudgetPercentStored
    ? roundMoney(drBudgetPercentStored)
    : DEFAULT_DR_BUDGET_PERCENT;
  fieldSources.drBudgetPercent = drBudgetPercentStored
    ? drBudgetPercentSourceHint === 'suggested'
      ? {
          source: 'suggested',
          confidence: 0.72,
          note: 'Pourcentage DR suggere automatiquement',
        }
      : drBudgetPercentSourceHint === 'inferred'
        ? {
            source: 'inferred',
            confidence: 0.6,
            note: 'Pourcentage DR infere automatiquement',
          }
        : {
            source: 'user_input',
            confidence: 0.95,
            note: 'Pourcentage DR fourni manuellement',
          }
    : {
        source: 'market_reference',
        confidence: 0.4,
        note: 'Valeur conservative de reference (3-5%)',
      };

  const biaHourlyDowntime = (latestBiaReport?.processes || [])
    .map((process) => extractBiaHourlyCost(process.financialImpact))
    .filter((value): value is number => Number.isFinite(value as number) && Number(value) > 0)
    .reduce((sum, value) => sum + value, 0);

  const storedHourlyDowntime =
    toPositiveNumber(profile?.customDowntimeCostPerHour) ??
    toPositiveNumber(profile?.hourlyDowntimeCost);
  const hourlySourceHint =
    persistedFieldSources.hourlyDowntimeCost ?? persistedFieldSources.customDowntimeCostPerHour;
  const userHourlyDowntime =
    storedHourlyDowntime && (hourlySourceHint === 'user_input' || !hourlySourceHint)
      ? storedHourlyDowntime
      : null;
  const suggestedHourlyDowntime =
    storedHourlyDowntime && hourlySourceHint === 'suggested' ? storedHourlyDowntime : null;
  const inferredHourlyDowntime =
    storedHourlyDowntime && hourlySourceHint === 'inferred' ? storedHourlyDowntime : null;
  const fallbackMedianEur = inferDowntimeMedianFromEmployees(employeeCount);
  const fallbackMedian = CurrencyService.convertAmount(fallbackMedianEur, 'EUR', currency);

  const hourlyDowntimeCost = roundMoney(
    userHourlyDowntime ??
      (biaHourlyDowntime > 0
        ? CurrencyService.convertAmount(biaHourlyDowntime, 'EUR', currency)
        : suggestedHourlyDowntime ?? inferredHourlyDowntime ?? fallbackMedian),
  );

  if (userHourlyDowntime) {
    fieldSources.hourlyDowntimeCost = {
      source: 'user_input',
      confidence: 0.95,
      note: 'Cout d indisponibilite fourni manuellement',
    };
  } else if (biaHourlyDowntime > 0) {
    fieldSources.hourlyDowntimeCost = {
      source: 'bia_validated',
      confidence: 0.85,
      note: `${latestBiaReport?.processes.length || 0} processus BIA valides agrege(s)`,
    };
  } else if (suggestedHourlyDowntime) {
    fieldSources.hourlyDowntimeCost = {
      source: 'suggested',
      confidence: 0.72,
      note: 'Cout horaire suggere automatiquement',
    };
  } else if (inferredHourlyDowntime) {
    fieldSources.hourlyDowntimeCost = {
      source: 'inferred',
      confidence: 0.6,
      note: 'Cout horaire infere automatiquement',
    };
  } else {
    fieldSources.hourlyDowntimeCost = {
      source: 'market_reference',
      confidence: 0.4,
      note: 'Medianes conservatives derivees des references marche',
    };
  }

  const estimatedDrBudgetAnnual =
    annualITBudget && drBudgetPercent ? roundMoney((annualITBudget * drBudgetPercent) / 100) : null;

  const sourceKinds = listFieldSourceKinds(fieldSources);
  const hasUser = sourceKinds.has('user_input');
  const hasInferred =
    sourceKinds.has('suggested') ||
    sourceKinds.has('inferred') ||
    sourceKinds.has('inferred_infrastructure') ||
    sourceKinds.has('market_reference');
  const hasBia = sourceKinds.has('bia_validated');

  const source: CompanyFinancialProfileSource =
    hasUser && (hasInferred || hasBia) ? 'hybrid' : hasUser ? 'user_input' : 'inferred';

  const confidenceValues = Object.values(fieldSources)
    .map((trace) => trace.confidence)
    .filter((value) => Number.isFinite(value));
  const confidence = roundPercent(
    confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : 0.4,
  );

  return {
    tenantId,
    source,
    confidence,
    annualRevenue: annualRevenue || null,
    employeeCount: employeeCount || null,
    industrySector,
    annualITBudget: annualITBudget || null,
    drBudgetPercent: drBudgetPercent || null,
    hourlyDowntimeCost: hourlyDowntimeCost || 0,
    currency,
    estimatedDrBudgetAnnual,
    fieldSources,
    sourceDisclaimer:
      source === 'user_input'
        ? DR_FINANCIAL_SOURCES.downtimeCost
        : `${DR_FINANCIAL_SOURCES.downtimeCost}. ${DR_FINANCIAL_SOURCES.strategyMatrix}.`,
    inferenceBanner:
      source === 'inferred'
        ? 'Profil financier estime automatiquement - Personnalisez vos donnees pour des resultats plus precis'
        : source === 'hybrid'
          ? 'Profil financier mixte (saisie + inference) - Verifiez les valeurs inferees'
          : null,
    sizeCategory: profile?.sizeCategory || 'midMarket',
    verticalSector: profile?.verticalSector || null,
    customDowntimeCostPerHour: userHourlyDowntime ? roundMoney(userHourlyDowntime) : null,
    customCurrency: currency,
    strongholdPlanId: profile?.strongholdPlanId || null,
    strongholdMonthlyCost: toPositiveNumber(profile?.strongholdMonthlyCost),
    isConfigured: isExplicitlyConfigured(profile),
  };
}

export function estimateServiceMonthlyProductionCost(
  node: {
    type: string;
    provider?: string | null;
    metadata?: unknown;
    criticalityScore?: number | null;
    impactCategory?: string | null;
  },
  currency: SupportedCurrency = DEFAULT_CURRENCY,
): ServiceMonthlyCostEstimate {
  const metadata =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {};

  const override = toPositiveNumber(metadata.drMonthlyCostOverride);
  if (override) {
    return {
      estimatedMonthlyCost: roundMoney(override),
      costSource: 'user_override',
      confidence: 0.95,
      currency,
      note: 'Override utilisateur applique',
      sourceReference: 'User override',
    };
  }

  const cloudCost =
    metadata.cloudCost && typeof metadata.cloudCost === 'object' && !Array.isArray(metadata.cloudCost)
      ? (metadata.cloudCost as Record<string, unknown>)
      : null;
  const observedMonthlyUsd = toPositiveNumber(cloudCost?.monthlyTotalUSD);
  if (observedMonthlyUsd) {
    return {
      estimatedMonthlyCost: roundMoney(
        CurrencyService.convertAmount(observedMonthlyUsd, 'USD', currency),
      ),
      costSource: 'cloud_type_reference',
      confidence: 0.92,
      currency,
      note: 'Cout observe via metadonnees cloudCost',
      sourceReference: 'Observed cloud billing metadata',
    };
  }

  const nodeType = String(node.type || '').toUpperCase();
  const provider = String(node.provider || '').toLowerCase();
  if (nodeType === 'THIRD_PARTY_API' || nodeType === 'SAAS_SERVICE') {
    return {
      estimatedMonthlyCost: 0,
      costSource: 'cloud_type_reference',
      confidence: 0.95,
      currency,
      note: 'Service tiers externe (pas de redondance infra DR directe)',
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  if (nodeType === 'DATABASE') {
    const engine = String(metadata.engine || '').toLowerCase();
    const instanceSize = inferInstanceSize(metadata);
    if (engine.includes('elasticsearch') || engine.includes('opensearch')) {
      const range = RESOURCE_MONTHLY_COST_REFERENCES.database.elasticsearch;
      return {
        estimatedMonthlyCost: roundMoney(midpoint(range.min, range.max)),
        costSource: 'cloud_type_reference',
        confidence: 0.75,
        currency,
        note: 'Reference Elasticsearch/OpenSearch',
        sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
      };
    }
    const range =
      instanceSize === 'large'
        ? RESOURCE_MONTHLY_COST_REFERENCES.database.large
        : instanceSize === 'medium'
          ? RESOURCE_MONTHLY_COST_REFERENCES.database.medium
          : RESOURCE_MONTHLY_COST_REFERENCES.database.small;
    return {
      estimatedMonthlyCost: roundMoney(midpoint(range.min, range.max)),
      costSource: 'cloud_type_reference',
      confidence: 0.78,
      currency,
      note: `Reference DB ${instanceSize}`,
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  if (nodeType === 'CACHE') {
    const range = RESOURCE_MONTHLY_COST_REFERENCES.database.redis_cache;
    return {
      estimatedMonthlyCost: roundMoney(midpoint(range.min, range.max)),
      costSource: 'cloud_type_reference',
      confidence: 0.75,
      currency,
      note: 'Reference cache manag e',
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  if (nodeType === 'OBJECT_STORAGE' || nodeType === 'FILE_STORAGE') {
    const storageGb = toPositiveNumber(
      metadata.storageGB ?? metadata.storageGb ?? metadata.sizeGB ?? metadata.sizeGb,
    );
    const tb = Math.max(1, (storageGb || 1_024) / 1_024);
    const range =
      nodeType === 'OBJECT_STORAGE'
        ? RESOURCE_MONTHLY_COST_REFERENCES.storage.object_per_tb
        : RESOURCE_MONTHLY_COST_REFERENCES.storage.disk_500gb_ssd;
    return {
      estimatedMonthlyCost: roundMoney(tb * midpoint(range.min, range.max)),
      costSource: 'cloud_type_reference',
      confidence: 0.7,
      currency,
      note: 'Reference stockage',
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  if (nodeType === 'LOAD_BALANCER') {
    const range = RESOURCE_MONTHLY_COST_REFERENCES.network.load_balancer;
    return {
      estimatedMonthlyCost: roundMoney(midpoint(range.min, range.max)),
      costSource: 'cloud_type_reference',
      confidence: 0.72,
      currency,
      note: 'Reference load balancer',
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  if (nodeType === 'API_GATEWAY' || nodeType === 'DNS') {
    const range = RESOURCE_MONTHLY_COST_REFERENCES.network.api_gateway;
    return {
      estimatedMonthlyCost: roundMoney(midpoint(range.min, range.max)),
      costSource: 'cloud_type_reference',
      confidence: 0.7,
      currency,
      note: 'Reference API Gateway/DNS',
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  if (nodeType === 'CDN') {
    const range = RESOURCE_MONTHLY_COST_REFERENCES.network.cdn;
    return {
      estimatedMonthlyCost: roundMoney(midpoint(range.min, range.max)),
      costSource: 'cloud_type_reference',
      confidence: 0.72,
      currency,
      note: 'Reference CDN',
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  if (nodeType === 'MESSAGE_QUEUE') {
    const range = RESOURCE_MONTHLY_COST_REFERENCES.messaging.queue;
    return {
      estimatedMonthlyCost: roundMoney(midpoint(range.min, range.max)),
      costSource: 'cloud_type_reference',
      confidence: 0.7,
      currency,
      note: 'Reference messaging queue',
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  if (nodeType === 'SERVERLESS') {
    const range = RESOURCE_MONTHLY_COST_REFERENCES.compute.serverless;
    return {
      estimatedMonthlyCost: roundMoney(midpoint(range.min, range.max)),
      costSource: 'cloud_type_reference',
      confidence: 0.68,
      currency,
      note: 'Reference serverless',
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  if (
    [
      'VM',
      'PHYSICAL_SERVER',
      'APPLICATION',
      'MICROSERVICE',
      'CONTAINER',
      'KUBERNETES_POD',
      'KUBERNETES_SERVICE',
      'KUBERNETES_CLUSTER',
    ].includes(nodeType)
  ) {
    const instanceSize = inferInstanceSize(metadata);
    const replicas = Math.max(1, Math.floor(toPositiveNumber(metadata.replicas) || 1));

    const perUnitRange =
      nodeType === 'MICROSERVICE' ||
      nodeType === 'CONTAINER' ||
      nodeType === 'KUBERNETES_POD' ||
      nodeType === 'KUBERNETES_SERVICE' ||
      nodeType === 'KUBERNETES_CLUSTER'
        ? RESOURCE_MONTHLY_COST_REFERENCES.compute.kubernetes_pod
        : instanceSize === 'large'
          ? RESOURCE_MONTHLY_COST_REFERENCES.compute.vm_large
          : instanceSize === 'medium'
            ? RESOURCE_MONTHLY_COST_REFERENCES.compute.vm_medium
            : RESOURCE_MONTHLY_COST_REFERENCES.compute.vm_small;

    const base = midpoint(perUnitRange.min, perUnitRange.max) * replicas;
    return {
      estimatedMonthlyCost: roundMoney(base),
      costSource: 'cloud_type_reference',
      confidence: provider === 'on_premise' ? 0.5 : 0.72,
      currency,
      note: `Reference compute ${instanceSize} x${replicas}`,
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  const criticality = inferCriticalityBucket(node);
  const fallback =
    criticality === 'critical' || criticality === 'high'
      ? 300
      : criticality === 'medium'
        ? 150
        : 50;
  return {
    estimatedMonthlyCost: roundMoney(fallback),
    costSource: 'criticality_fallback',
    confidence: 0.45,
    currency,
    note: `Fallback criticite (${criticality})`,
    sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
  };
}

function getDefaultStrategyFromCriticality(
  criticality: 'critical' | 'high' | 'medium' | 'low',
): DrStrategyKey {
  if (criticality === 'critical') return 'warm_standby';
  if (criticality === 'high') return 'pilot_light';
  return 'backup_restore';
}

function strategyOrder(strategy: DrStrategyKey): number {
  return DR_STRATEGY_PROFILES[strategy].order;
}

function orderedStrategies(): DrStrategyKey[] {
  return (Object.keys(DR_STRATEGY_PROFILES) as DrStrategyKey[]).sort(
    (left, right) => DR_STRATEGY_PROFILES[left].order - DR_STRATEGY_PROFILES[right].order,
  );
}

export function estimateStrategyMonthlyDrCost(
  monthlyProductionCost: number,
  strategy: DrStrategyKey,
): number {
  const profile = DR_STRATEGY_PROFILES[strategy];
  const multiplierCost = Math.max(0, monthlyProductionCost) * profile.productionCostMultiplier;
  return roundMoney(
    Math.max(multiplierCost, profile.monthlyCostFloor),
  );
}

export function findNextImprovingStrategy(
  strategy: DrStrategyKey,
  currentRtoMinutes?: number | null,
): DrStrategyKey | null {
  const parsedCurrentRto = Number(currentRtoMinutes);
  if (!Number.isFinite(parsedCurrentRto) || parsedCurrentRto < 0) return strategy;

  const sorted = orderedStrategies();
  const currentIndex = sorted.indexOf(strategy);
  if (currentIndex === -1) return strategy;

  for (let index = currentIndex; index < sorted.length; index += 1) {
    const candidate = sorted[index] as DrStrategyKey;
    if (DR_STRATEGY_PROFILES[candidate].rtoTypicalMinutes < parsedCurrentRto) {
      return candidate;
    }
  }

  return null;
}

function pickLeastCostStrategyForTargets(
  targetRtoMinutes: number,
  targetRpoMinutes: number,
): DrStrategyKey {
  const rto = Math.max(0, targetRtoMinutes);
  const rpo = Math.max(0, targetRpoMinutes);

  if (rto < 5 && rpo <= 1) return 'active_active';
  if (rto <= 15 && rpo < 5) return 'hot_standby';
  if (rto <= 30 && rpo < 15) return 'warm_standby';
  if (rto <= 240 && rpo < 60) return 'pilot_light';
  return 'backup_restore';
}

export function selectDrStrategyForService(options: {
  targetRtoMinutes?: number | null;
  targetRpoMinutes?: number | null;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  monthlyProductionCost: number;
  budgetRemainingMonthly?: number | null;
  overrideStrategy?: string | null;
}): StrategySelectionResult {
  const overrideKey = String(options.overrideStrategy || '').toLowerCase().replace(/[-\s]/g, '_');
  if (overrideKey in DR_STRATEGY_PROFILES) {
    const strategy = overrideKey as DrStrategyKey;
    const monthlyDrCost = estimateStrategyMonthlyDrCost(options.monthlyProductionCost, strategy);
    return {
      strategy,
      monthlyDrCost,
      annualDrCost: roundMoney(monthlyDrCost * 12),
      budgetWarning: null,
      strategySource: 'user_override',
      rationale: ['Strategie forcee par override utilisateur'],
    };
  }

  const sorted = orderedStrategies();

  const targetRto = toPositiveNumber(options.targetRtoMinutes);
  const targetRpo = toPositiveNumber(options.targetRpoMinutes);

  let selected: DrStrategyKey | null = null;
  const rationale: string[] = [];

  if (targetRto && targetRpo) {
    const targetBased = pickLeastCostStrategyForTargets(targetRto, targetRpo);
    const floorByCriticality = getDefaultStrategyFromCriticality(options.criticality);
    selected =
      strategyOrder(targetBased) >= strategyOrder(floorByCriticality)
        ? targetBased
        : floorByCriticality;
    rationale.push(
      `Cible RTO/RPO ${targetRto}min/${targetRpo}min -> ${targetBased}`,
      `Contrainte criticite ${options.criticality} -> minimum ${floorByCriticality}`,
    );
  }

  if (!selected) {
    selected = getDefaultStrategyFromCriticality(options.criticality);
    rationale.push(`Fallback criticite ${options.criticality}`);
  }

  let monthlyDrCost = estimateStrategyMonthlyDrCost(options.monthlyProductionCost, selected);
  let strategySource: StrategySelectionResult['strategySource'] = 'recommended';
  let budgetWarning: string | null = null;

  const budgetRemaining = toPositiveNumber(options.budgetRemainingMonthly);
  if (budgetRemaining && monthlyDrCost > budgetRemaining) {
    const selectedIndex = sorted.indexOf(selected);
    if (selectedIndex > 0) {
      const downgraded = sorted[selectedIndex - 1] as DrStrategyKey;
      selected = downgraded;
      strategySource = 'budget_adjusted';
      monthlyDrCost = estimateStrategyMonthlyDrCost(options.monthlyProductionCost, selected);
      budgetWarning =
        'Budget depasse: strategie ajustee au niveau inferieur pour respecter le budget DR estime';
      rationale.push('Ajustement budget');
    } else {
      budgetWarning =
        'Budget depasse: aucune strategie inferieure disponible, verification budget recommandee';
    }
  }

  return {
    strategy: selected,
    monthlyDrCost,
    annualDrCost: roundMoney(monthlyDrCost * 12),
    budgetWarning,
    strategySource,
    rationale,
  };
}

export function resolveIncidentProbabilityForNodeType(
  nodeType: string,
  customProbabilities?: Partial<Record<IncidentProbabilityKey, number>>,
): { key: IncidentProbabilityKey; probabilityAnnual: number; source: string } {
  const type = String(nodeType || '').toUpperCase();
  let key: IncidentProbabilityKey = 'infrastructure';
  if (type === 'DATABASE') key = 'database';
  else if (type === 'THIRD_PARTY_API' || type === 'SAAS_SERVICE') key = 'third_party';
  else if (type === 'DNS' || type === 'LOAD_BALANCER' || type === 'API_GATEWAY') key = 'dns_network';

  const override = toPositiveNumber(customProbabilities?.[key]);
  const base = INCIDENT_PROBABILITIES[key];
  return {
    key,
    probabilityAnnual: override ?? base.probabilityAnnual,
    source: override ? 'User-adjusted incident probability' : base.source,
  };
}

export function calculateRecommendationRoi(options: {
  hourlyDowntimeCost: number;
  currentRtoMinutes: number;
  targetRtoMinutes: number;
  incidentProbabilityAnnual: number;
  monthlyDrCost: number;
}): RecommendationRoiResult {
  const currentRtoHours = Math.max(0, options.currentRtoMinutes) / 60;
  const targetRtoHours = Math.max(0, options.targetRtoMinutes) / 60;
  const incidentProbabilityAnnual = Math.max(0, options.incidentProbabilityAnnual);
  const monthlyDrCost = Math.max(0, options.monthlyDrCost);

  const aleCurrent = roundMoney(
    options.hourlyDowntimeCost * currentRtoHours * incidentProbabilityAnnual,
  );
  const aleAfter = roundMoney(
    options.hourlyDowntimeCost * targetRtoHours * incidentProbabilityAnnual,
  );
  const riskAvoidedAnnual = roundMoney(aleCurrent - aleAfter);
  const annualDrCost = roundMoney(monthlyDrCost * 12);

  let roiPercent: number | null = null;
  if (riskAvoidedAnnual > 0 && annualDrCost > 0) {
    roiPercent = roundPercent(((riskAvoidedAnnual - annualDrCost) / annualDrCost) * 100);
  }

  const paybackMonths =
    riskAvoidedAnnual > 0 && annualDrCost > 0
      ? roundPercent(annualDrCost / (riskAvoidedAnnual / 12))
      : null;
  const paybackLabel = classifyPaybackLabel(paybackMonths);

  const roiState = classifyRoiStatus(roiPercent, riskAvoidedAnnual, annualDrCost);

  return {
    aleCurrent,
    aleAfter,
    riskAvoidedAnnual,
    annualDrCost,
    roiPercent,
    roiStatus: roiState.status,
    roiMessage: roiState.message,
    paybackMonths,
    paybackLabel,
    formula:
      'ALE = hourlyDowntimeCost x RTO(hours) x annualIncidentProbability; ROI = ((riskAvoided - annualDrCost) / annualDrCost) x 100',
    inputs: {
      hourlyDowntimeCost: roundMoney(options.hourlyDowntimeCost),
      currentRtoHours: roundPercent(currentRtoHours),
      targetRtoHours: roundPercent(targetRtoHours),
      incidentProbabilityAnnual: roundPercent(incidentProbabilityAnnual),
      monthlyDrCost: roundMoney(monthlyDrCost),
    },
  };
}

export function strategyKeyToLegacySlug(strategy: DrStrategyKey): string {
  return strategy.replace(/_/g, '-');
}

export function strategyTargetRtoMinutes(strategy: DrStrategyKey): number {
  return DR_STRATEGY_PROFILES[strategy].rtoTypicalMinutes;
}

export function strategyTargetRpoMinutes(strategy: DrStrategyKey): number {
  return DR_STRATEGY_PROFILES[strategy].rpoMaxMinutes;
}

export function buildFinancialDisclaimers() {
  return {
    profile: DR_FINANCIAL_SOURCES.downtimeCost,
    strategy: DR_FINANCIAL_SOURCES.strategyMatrix,
    probability: DR_FINANCIAL_SOURCES.incidentProbabilities,
    serviceCost: DR_FINANCIAL_SOURCES.serviceCost,
  };
}
