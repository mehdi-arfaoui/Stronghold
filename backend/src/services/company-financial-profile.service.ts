import type { OrganizationProfile, PrismaClient } from '@prisma/client';
import type { SupportedCurrency } from '../constants/market-financial-data.js';
import { SUPPORTED_CURRENCIES } from '../constants/market-financial-data.js';
import {
  DEFAULT_CURRENCY,
  DR_FINANCIAL_SOURCES,
  DR_STRATEGY_COST_FACTORS,
  DR_STRATEGY_PROFILES,
  INCIDENT_PROBABILITIES,
  RESOURCE_MONTHLY_COST_REFERENCES,
  type CostSourceKey,
  type DrStrategyKey,
  type IncidentProbabilityKey,
  type ProfileValueSourceKey,
} from '../constants/dr-financial-reference-data.js';
import { CurrencyService } from './currency.service.js';
import {
  buildProviderServiceRecommendation,
  convertEstimateToCurrency,
  lookupEstimatedMonthlyReference,
  resolveProviderFloorStrategy,
  resolveProviderIncidentProbability,
  resolveProviderNativeCostFactor,
  resolveServiceResolution,
  type CloudServiceResolution,
} from './dr-recommendation-engine/recommendationEngine.js';
import { cloudPricingService } from './pricing/cloudPricingService.js';
import type { PricingResult } from './pricing/pricingTypes.js';

export type CompanyFinancialProfileSource = 'user_input' | 'inferred' | 'hybrid';
export type FinancialComputationMode = 'infra_only' | 'business_profile';

export type FinancialFieldTrace = {
  source: ProfileValueSourceKey;
  confidence: number;
  note: string;
};

export type CriticalBusinessHours = {
  start: string;
  end: string;
  timezone: string;
};

export type FinancialServiceOverride = {
  nodeId: string;
  customDowntimeCostPerHour?: number;
  customCriticalityTier?: 'critical' | 'high' | 'medium' | 'low';
};

export type ResolvedCompanyFinancialProfile = {
  tenantId: string;
  source: CompanyFinancialProfileSource;
  mode: FinancialComputationMode;
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
  reviewBanner: string | null;
  requiresReview: boolean;
  sizeCategory: string;
  verticalSector: string | null;
  customDowntimeCostPerHour: number | null;
  customCurrency: SupportedCurrency;
  strongholdPlanId: string | null;
  strongholdMonthlyCost: number | null;
  numberOfCustomers: number | null;
  criticalBusinessHours: CriticalBusinessHours | null;
  regulatoryConstraints: string[];
  serviceOverrides: FinancialServiceOverride[];
  isConfigured: boolean;
};

export type ServiceMonthlyCostEstimate = {
  estimatedMonthlyCost: number;
  costSource: CostSourceKey;
  pricingSource: PricingResult['source'];
  pricingSourceLabel: PricingResult['sourceLabel'];
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

export type ServiceSpecificRecommendation = {
  action: string;
  resilienceImpact: string;
  text: string;
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

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readPositiveNumberFromKeys(
  metadata: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const parsed = toPositiveNumber(metadata[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function readStringFromKeys(
  metadata: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = readString(metadata[key]);
    if (value) return value;
  }
  return null;
}

function resolveCloudContext(
  nodeType: string,
  provider: string | null | undefined,
  metadata: Record<string, unknown>,
): CloudServiceResolution {
  return resolveServiceResolution({
    nodeType,
    provider: provider ?? null,
    metadata,
  });
}

function formatMonthlyCost(amount: number, currency: SupportedCurrency): string {
  return `${roundMoney(Math.max(0, amount)).toFixed(2)} ${currency}/mois`;
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

function readProfileMetadataObject(profile: OrganizationProfile | null): Record<string, unknown> {
  if (!profile?.profileMetadata) return {};
  if (typeof profile.profileMetadata !== 'object' || Array.isArray(profile.profileMetadata)) {
    return {};
  }
  return profile.profileMetadata as Record<string, unknown>;
}

function parseCriticalBusinessHours(rawValue: unknown): CriticalBusinessHours | null {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return null;
  const payload = rawValue as Record<string, unknown>;
  const start = readString(payload.start);
  const end = readString(payload.end);
  const timezone = readString(payload.timezone);
  if (!start || !end || !timezone) return null;
  return { start, end, timezone };
}

function parseRegulatoryConstraints(rawValue: unknown): string[] {
  if (!Array.isArray(rawValue)) return [];
  return rawValue
    .map((value) => readString(value))
    .filter((value): value is string => Boolean(value));
}

function parseServiceOverrides(rawValue: unknown): FinancialServiceOverride[] {
  if (!Array.isArray(rawValue)) return [];
  const overrides: FinancialServiceOverride[] = [];

  for (const rawItem of rawValue) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
    const payload = rawItem as Record<string, unknown>;
    const nodeId = readString(payload.nodeId);
    if (!nodeId) continue;

    const customDowntime = toPositiveNumber(payload.customDowntimeCostPerHour);
    const tierRaw = readString(payload.customCriticalityTier)?.toLowerCase();
    const customCriticalityTier =
      tierRaw === 'critical' || tierRaw === 'high' || tierRaw === 'medium' || tierRaw === 'low'
        ? tierRaw
        : undefined;

    overrides.push({
      nodeId,
      ...(customDowntime != null ? { customDowntimeCostPerHour: customDowntime } : {}),
      ...(customCriticalityTier ? { customCriticalityTier } : {}),
    });
  }

  return overrides;
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
  const profile = await prismaClient.organizationProfile.findUnique({ where: { tenantId } });
  const storedCurrency = normalizeCurrency(profile?.customCurrency ?? DEFAULT_CURRENCY);
  const currency = normalizeCurrency(options?.preferredCurrency ?? storedCurrency);
  const persistedFieldSources = readPersistedFieldSources(profile);
  const normalizedProfileSource = String(profile?.profileSource || '').toLowerCase();
  const metadataObject = readProfileMetadataObject(profile);
  const numberOfCustomers = toPositiveNumber(metadataObject.numberOfCustomers);
  const criticalBusinessHours = parseCriticalBusinessHours(metadataObject.criticalBusinessHours);
  const regulatoryConstraints = parseRegulatoryConstraints(metadataObject.regulatoryConstraints);
  const serviceOverrides = parseServiceOverrides(metadataObject.serviceOverrides);

  const convertFromStoredCurrency = (value: number | null): number | null => {
    if (value == null) return null;
    return roundMoney(CurrencyService.convertAmount(value, storedCurrency, currency));
  };

  const annualRevenueFromAnnualField = toPositiveNumber(profile?.annualRevenue);
  const annualRevenueFromUsdField = toPositiveNumber(profile?.annualRevenueUSD)
    ? CurrencyService.convertAmount(profile?.annualRevenueUSD as number, 'USD', currency)
    : null;
  const annualRevenueResolved = roundMoney(
    convertFromStoredCurrency(annualRevenueFromAnnualField) ?? annualRevenueFromUsdField ?? 0,
  );

  const employeeCountResolved = toPositiveNumber(profile?.employeeCount)
    ? Math.round(Number(profile?.employeeCount))
    : null;
  const industrySectorResolved = normalizeSector(profile?.industrySector ?? profile?.verticalSector) ?? null;
  const annualITBudgetResolved = roundMoney(convertFromStoredCurrency(toPositiveNumber(profile?.annualITBudget)) || 0);
  const drBudgetPercentResolved = roundMoney(toPositiveNumber(profile?.drBudgetPercent) || 0);
  const hourlyDowntimeStored =
    toPositiveNumber(profile?.customDowntimeCostPerHour) ??
    toPositiveNumber(profile?.hourlyDowntimeCost);
  const hourlyDowntimeResolved = roundMoney(convertFromStoredCurrency(hourlyDowntimeStored) || 0);

  const annualRevenueSourceHint = persistedFieldSources.annualRevenue ?? persistedFieldSources.annualRevenueUSD;
  const downtimeSourceHint =
    persistedFieldSources.customDowntimeCostPerHour ??
    persistedFieldSources.hourlyDowntimeCost;

  const sourceIsUser = (hint: ProfileValueSourceKey | undefined, hasValue: boolean): boolean => {
    if (!hasValue) return false;
    return hint === 'user_input';
  };

  const annualRevenueIsUser = sourceIsUser(annualRevenueSourceHint, annualRevenueResolved > 0);
  const downtimeIsUser = sourceIsUser(downtimeSourceHint, hourlyDowntimeResolved > 0);
  const annualITBudgetIsUser = sourceIsUser(
    persistedFieldSources.annualITBudget,
    annualITBudgetResolved > 0,
  );
  const drBudgetPercentIsUser = sourceIsUser(
    persistedFieldSources.drBudgetPercent,
    drBudgetPercentResolved > 0,
  );
  const hasBusinessCoreInputs = annualRevenueIsUser && downtimeIsUser;

  const hasMissingSourceWithBusinessValue =
    Boolean(profile) &&
    (
      (annualRevenueResolved > 0 && !annualRevenueSourceHint) ||
      (hourlyDowntimeResolved > 0 && !downtimeSourceHint) ||
      (annualITBudgetResolved > 0 && !persistedFieldSources.annualITBudget) ||
      (drBudgetPercentResolved > 0 && !persistedFieldSources.drBudgetPercent)
    );

  const hasLegacyInferredData =
    Boolean(profile) &&
    (
      normalizedProfileSource === 'inferred' ||
      annualRevenueSourceHint === 'suggested' ||
      annualRevenueSourceHint === 'inferred' ||
      annualRevenueSourceHint === 'inferred_infrastructure' ||
      downtimeSourceHint === 'suggested' ||
      downtimeSourceHint === 'inferred' ||
      downtimeSourceHint === 'inferred_infrastructure' ||
      hasMissingSourceWithBusinessValue
    );

  const fieldSources: Record<string, FinancialFieldTrace> = {};
  const buildTrace = (
    sourceHint: ProfileValueSourceKey | undefined,
    hasValue: boolean,
    manualLabel: string,
  ): FinancialFieldTrace => {
    if (!hasValue) {
      return {
        source: 'market_reference',
        confidence: 0,
        note: 'Valeur non renseignee',
      };
    }
    if (sourceHint === 'suggested') {
      return {
        source: 'suggested',
        confidence: 0.4,
        note: 'Valeur pre-remplie automatiquement - verification requise',
      };
    }
    if (sourceHint === 'inferred' || sourceHint === 'inferred_infrastructure') {
      return {
        source: 'inferred',
        confidence: 0.2,
        note: 'Valeur inferee automatiquement - verification requise',
      };
    }
    if (sourceHint === 'bia_validated') {
      return {
        source: 'bia_validated',
        confidence: 0.85,
        note: 'Valeur validee via processus BIA',
      };
    }
    if (sourceHint === 'user_input') {
      return {
        source: 'user_input',
        confidence: 0.95,
        note: manualLabel,
      };
    }
    return {
      source: 'inferred',
      confidence: 0.2,
      note: 'Valeur presente sans source verifiee - confirmation manuelle requise',
    };
  };

  fieldSources.annualRevenue = buildTrace(
    annualRevenueSourceHint,
    annualRevenueResolved > 0,
    'Valeur fournie manuellement',
  );
  fieldSources.employeeCount = buildTrace(
    persistedFieldSources.employeeCount,
    (employeeCountResolved || 0) > 0,
    'Valeur fournie manuellement',
  );
  fieldSources.industrySector = buildTrace(
    persistedFieldSources.industrySector ?? persistedFieldSources.verticalSector,
    Boolean(industrySectorResolved),
    'Secteur fourni manuellement',
  );
  fieldSources.annualITBudget = buildTrace(
    persistedFieldSources.annualITBudget,
    annualITBudgetResolved > 0,
    'Budget IT fourni manuellement',
  );
  fieldSources.drBudgetPercent = buildTrace(
    persistedFieldSources.drBudgetPercent,
    drBudgetPercentResolved > 0,
    'Pourcentage DR fourni manuellement',
  );
  fieldSources.hourlyDowntimeCost = buildTrace(
    downtimeSourceHint,
    hourlyDowntimeResolved > 0,
    'Cout d indisponibilite fourni manuellement',
  );

  const annualRevenue = hasBusinessCoreInputs ? annualRevenueResolved : null;
  const hourlyDowntimeCost = hasBusinessCoreInputs ? hourlyDowntimeResolved : 0;
  const customDowntimeCostPerHour =
    hasBusinessCoreInputs && toPositiveNumber(profile?.customDowntimeCostPerHour)
      ? roundMoney(
          CurrencyService.convertAmount(profile?.customDowntimeCostPerHour as number, storedCurrency, currency),
        )
      : null;

  const annualITBudget = annualITBudgetIsUser ? annualITBudgetResolved : null;
  const drBudgetPercent = drBudgetPercentIsUser ? drBudgetPercentResolved : null;
  const estimatedDrBudgetAnnual =
    annualITBudget && drBudgetPercent
      ? roundMoney((annualITBudget * drBudgetPercent) / 100)
      : null;

  const sourceKinds = listFieldSourceKinds(fieldSources);
  const hasUser = sourceKinds.has('user_input');
  const hasNonUser =
    sourceKinds.has('suggested') ||
    sourceKinds.has('inferred') ||
    sourceKinds.has('inferred_infrastructure') ||
    sourceKinds.has('market_reference');

  const source: CompanyFinancialProfileSource =
    hasUser && hasNonUser ? 'hybrid' : hasUser ? 'user_input' : 'inferred';
  const confidence = hasBusinessCoreInputs ? 0.95 : hasUser ? 0.7 : 0.35;
  const mode: FinancialComputationMode = hasBusinessCoreInputs ? 'business_profile' : 'infra_only';
  const requiresReview = hasLegacyInferredData && !hasBusinessCoreInputs;
  const reviewBanner = requiresReview
    ? 'Profil financier detecte comme auto-estime. Verification manuelle requise avant utilisation.'
    : null;
  const inferenceBanner =
    !hasBusinessCoreInputs && !requiresReview
      ? 'Calculs bases sur les couts d infrastructure uniquement. Configurez votre profil financier pour l impact business.'
      : null;

  return {
    tenantId,
    source,
    mode,
    confidence: roundPercent(confidence),
    annualRevenue,
    employeeCount: employeeCountResolved,
    industrySector: industrySectorResolved,
    annualITBudget,
    drBudgetPercent,
    hourlyDowntimeCost,
    currency,
    estimatedDrBudgetAnnual,
    fieldSources,
    sourceDisclaimer:
      mode === 'business_profile'
        ? DR_FINANCIAL_SOURCES.downtimeCost
        : 'Calculs bases sur les couts d infrastructure uniquement.',
    inferenceBanner,
    reviewBanner,
    requiresReview,
    sizeCategory: profile?.sizeCategory || 'midMarket',
    verticalSector: profile?.verticalSector || null,
    customDowntimeCostPerHour,
    customCurrency: currency,
    strongholdPlanId: profile?.strongholdPlanId || null,
    strongholdMonthlyCost: toPositiveNumber(profile?.strongholdMonthlyCost),
    numberOfCustomers,
    criticalBusinessHours,
    regulatoryConstraints,
    serviceOverrides,
    isConfigured: hasBusinessCoreInputs,
  };
}

export async function resolveServiceMonthlyProductionCost(
  node: {
    type: string;
    provider?: string | null;
    metadata?: unknown;
    preferredCurrency?: SupportedCurrency;
  },
): Promise<PricingResult> {
  return cloudPricingService.getResourceMonthlyCost({
    nodeType: node.type,
    provider: node.provider ?? null,
    metadata: node.metadata,
    preferredCurrency: node.preferredCurrency,
  });
}

export async function estimateServiceMonthlyProductionCostAsync(
  node: {
    type: string;
    provider?: string | null;
    metadata?: unknown;
    criticalityScore?: number | null;
    impactCategory?: string | null;
  },
  currency: SupportedCurrency = DEFAULT_CURRENCY,
): Promise<ServiceMonthlyCostEstimate> {
  const pricing = await resolveServiceMonthlyProductionCost({
    type: node.type,
    ...(node.provider !== undefined ? { provider: node.provider } : {}),
    metadata: node.metadata,
    preferredCurrency: currency,
  });

  if (pricing.monthlyCost > 0 || pricing.source === 'static-table') {
    return {
      estimatedMonthlyCost: roundMoney(pricing.monthlyCost),
      costSource: 'cloud_type_reference',
      pricingSource: pricing.source,
      pricingSourceLabel: pricing.sourceLabel,
      confidence: pricing.confidence,
      currency,
      note: pricing.note,
      sourceReference: pricing.note,
    };
  }

  return estimateServiceMonthlyProductionCost(node, currency);
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
  const metadata = asMetadataRecord(node.metadata);

  const override = toPositiveNumber(metadata.drMonthlyCostOverride);
  if (override) {
    return {
      estimatedMonthlyCost: roundMoney(override),
      costSource: 'user_override',
      pricingSource: 'cost-explorer',
      pricingSourceLabel: '[Prix reel ✓✓]',
      confidence: 0.95,
      currency,
      note: 'Override utilisateur applique',
      sourceReference: 'User override',
    };
  }

  const cloudCost = asMetadataRecord(metadata.cloudCost);
  const observedMonthlyUsd =
    toPositiveNumber(cloudCost.monthlyTotalUSD) ??
    toPositiveNumber(metadata.monthlyCostUSD) ??
    toPositiveNumber(metadata.observedMonthlyCostUSD);
  const observedMonthlyEur =
    toPositiveNumber(cloudCost.monthlyTotalEUR) ??
    toPositiveNumber(metadata.monthlyCostEUR) ??
    toPositiveNumber(metadata.observedMonthlyCostEUR);
  if (observedMonthlyUsd || observedMonthlyEur) {
    const observedInCurrency = observedMonthlyUsd
      ? CurrencyService.convertAmount(observedMonthlyUsd, 'USD', currency)
      : CurrencyService.convertAmount(observedMonthlyEur || 0, 'EUR', currency);
    return {
      estimatedMonthlyCost: roundMoney(observedInCurrency),
      costSource: 'cloud_type_reference',
      pricingSource: 'cost-explorer',
      pricingSourceLabel: '[Prix reel ✓✓]',
      confidence: 0.95,
      currency,
      note: 'Cout observe via metadonnees cloud billing',
      sourceReference: 'Observed cloud billing metadata',
    };
  }

  const nodeType = String(node.type || '').toUpperCase();
  const provider = String(node.provider || '').toLowerCase();
  const resolution = resolveCloudContext(nodeType, provider, metadata);

  if (nodeType === 'THIRD_PARTY_API' || nodeType === 'SAAS_SERVICE') {
    return {
      estimatedMonthlyCost: 0,
      costSource: 'cloud_type_reference',
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
      confidence: 0.95,
      currency,
      note: 'Service tiers externe (pas de redondance infra DR directe)',
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  const providerEstimate = lookupEstimatedMonthlyReference(resolution);
  if (providerEstimate) {
    const providerLabel =
      resolution.provider === 'aws'
        ? 'AWS eu-west-3'
        : resolution.provider === 'azure'
          ? 'Azure westeurope/francecentral'
          : resolution.provider === 'gcp'
            ? 'GCP europe-west1/europe-west9'
            : resolution.provider;
    return {
      estimatedMonthlyCost: roundMoney(
        convertEstimateToCurrency(providerEstimate, currency),
      ),
      costSource: 'cloud_type_reference',
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
      confidence: 0.75,
      currency,
      note: `Reference ${providerLabel} (${resolution.kind})`,
      sourceReference: providerEstimate.source,
    };
  }

  if (nodeType === 'SERVERLESS') {
    return {
      estimatedMonthlyCost: 0,
      costSource: 'cloud_type_reference',
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
      confidence: 0.9,
      currency,
      note: 'Serverless pay-per-use (standby quasi nul)',
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  if (
    nodeType === 'MESSAGE_QUEUE' &&
    ['sqs', 'sns', 'pubsub', 'cloudTasks', 'eventGrid'].includes(resolution.kind)
  ) {
    return {
      estimatedMonthlyCost: 0,
      costSource: 'cloud_type_reference',
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
      confidence: 0.9,
      currency,
      note: 'Queue/topic managed (cout operationnel minimal)',
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  if (nodeType === 'DATABASE' && ['dynamodb', 'firestore'].includes(resolution.kind)) {
    return {
      estimatedMonthlyCost: 0,
      costSource: 'cloud_type_reference',
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
      confidence: 0.9,
      currency,
      note: 'DynamoDB/Firestore pay-per-use',
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
        pricingSource: 'static-table',
        pricingSourceLabel: '[Estimation ≈]',
        confidence: 0.7,
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
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
      confidence: 0.7,
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
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
      confidence: 0.7,
      currency,
      note: 'Reference cache manage',
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
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
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
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
      confidence: 0.7,
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
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
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
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
      confidence: 0.7,
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
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
      confidence: 0.7,
      currency,
      note: 'Reference messaging queue',
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
      pricingSource: 'static-table',
      pricingSourceLabel: '[Estimation ≈]',
      confidence: provider === 'on_premise' ? 0.5 : 0.7,
      currency,
      note: `Reference compute ${instanceSize} x${replicas}`,
      sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
    };
  }

  const criticality = inferCriticalityBucket(node);
  const fallback =
    criticality === 'critical' || criticality === 'high'
      ? 120
      : criticality === 'medium'
        ? 60
        : 20;
  return {
    estimatedMonthlyCost: roundMoney(fallback),
    costSource: 'criticality_fallback',
    pricingSource: 'static-table',
    pricingSourceLabel: '[Estimation ≈]',
    confidence: 0.45,
    currency,
    note: `Fallback criticite (${criticality})`,
    sourceReference: DR_FINANCIAL_SOURCES.serviceCost,
  };
}

export function isBusinessProfileConfigured(
  profile: Pick<ResolvedCompanyFinancialProfile, 'annualRevenue' | 'hourlyDowntimeCost' | 'mode'>,
): boolean {
  return profile.mode === 'business_profile' && Number(profile.annualRevenue) > 0 && Number(profile.hourlyDowntimeCost) > 0;
}
function getDefaultStrategyFromCriticality(
  criticality: 'critical' | 'high' | 'medium' | 'low',
): DrStrategyKey {
  if (criticality === 'critical') return 'warm_standby';
  if (criticality === 'high') return 'pilot_light';
  return 'backup_restore';
}

type DrStrategyContext = {
  nodeType?: string | undefined;
  provider?: string | null | undefined;
  metadata?: unknown | undefined;
};

function resolveServiceFloorStrategy(
  criticality: 'critical' | 'high' | 'medium' | 'low',
  context?: DrStrategyContext,
): DrStrategyKey {
  const defaultFloor = getDefaultStrategyFromCriticality(criticality);
  if (!context) {
    return defaultFloor;
  }

  const nodeType = String(context.nodeType || '').toUpperCase();
  const metadata = asMetadataRecord(context.metadata);
  const resolution = resolveCloudContext(nodeType, context.provider, metadata);
  return resolveProviderFloorStrategy({
    criticality,
    defaultFloor,
    resolution,
  });
}

function resolveServiceNativeCostFactor(
  strategy: DrStrategyKey,
  context?: DrStrategyContext,
): number | null {
  if (!context) return null;

  const nodeType = String(context.nodeType || '').toUpperCase();
  const metadata = asMetadataRecord(context.metadata);
  const resolution = resolveCloudContext(nodeType, context.provider, metadata);
  return resolveProviderNativeCostFactor({
    strategy,
    resolution,
  });
}

function strategyOrder(strategy: DrStrategyKey): number {
  return DR_STRATEGY_PROFILES[strategy].order;
}

function strongestStrategy(left: DrStrategyKey, right: DrStrategyKey): DrStrategyKey {
  return strategyOrder(left) >= strategyOrder(right) ? left : right;
}

function orderedStrategies(): DrStrategyKey[] {
  return (Object.keys(DR_STRATEGY_PROFILES) as DrStrategyKey[]).sort(
    (left, right) => DR_STRATEGY_PROFILES[left].order - DR_STRATEGY_PROFILES[right].order,
  );
}

export function estimateStrategyMonthlyDrCost(
  monthlyProductionCost: number,
  strategy: DrStrategyKey,
  context?: DrStrategyContext,
): number {
  const baseMonthly = Math.max(0, monthlyProductionCost);
  const nativeFactor = resolveServiceNativeCostFactor(strategy, context);
  if (nativeFactor != null) {
    return roundMoney(baseMonthly * nativeFactor);
  }

  const strategyFactor =
    DR_STRATEGY_COST_FACTORS[strategy]?.default ??
    DR_STRATEGY_PROFILES[strategy].productionCostMultiplier;
  const monthlyFloor = DR_STRATEGY_PROFILES[strategy]?.monthlyCostFloor ?? 0;
  return roundMoney(Math.max(baseMonthly * strategyFactor, monthlyFloor));
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
  nodeType?: string;
  provider?: string | null;
  metadata?: unknown;
}): StrategySelectionResult {
  const strategyContext: DrStrategyContext = {
    nodeType: options.nodeType,
    provider: options.provider,
    metadata: options.metadata,
  };
  const overrideKey = String(options.overrideStrategy || '').toLowerCase().replace(/[-\s]/g, '_');
  if (overrideKey in DR_STRATEGY_PROFILES) {
    const strategy = overrideKey as DrStrategyKey;
    const monthlyDrCost = estimateStrategyMonthlyDrCost(
      options.monthlyProductionCost,
      strategy,
      strategyContext,
    );
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

  const floorByServiceAndCriticality = resolveServiceFloorStrategy(options.criticality, strategyContext);
  let selected: DrStrategyKey | null = null;
  const rationale: string[] = [];

  if (targetRto && targetRpo) {
    const targetBased = pickLeastCostStrategyForTargets(targetRto, targetRpo);
    selected = strongestStrategy(targetBased, floorByServiceAndCriticality);
    rationale.push(
      `Cible RTO/RPO ${targetRto}min/${targetRpo}min -> ${targetBased}`,
      `Contrainte criticite/service ${options.criticality} -> minimum ${floorByServiceAndCriticality}`,
    );
  }

  if (!selected) {
    selected = floorByServiceAndCriticality;
    rationale.push(`Fallback criticite/service ${options.criticality}`);
  }

  let monthlyDrCost = estimateStrategyMonthlyDrCost(
    options.monthlyProductionCost,
    selected,
    strategyContext,
  );
  let strategySource: StrategySelectionResult['strategySource'] = 'recommended';
  let budgetWarning: string | null = null;

  const budgetRemaining = toPositiveNumber(options.budgetRemainingMonthly);
  if (budgetRemaining && monthlyDrCost > budgetRemaining) {
    let selectedIndex = sorted.indexOf(selected);
    const floorIndex = sorted.indexOf(floorByServiceAndCriticality);

    while (monthlyDrCost > budgetRemaining && selectedIndex > floorIndex) {
      selectedIndex -= 1;
      selected = sorted[selectedIndex] as DrStrategyKey;
      strategySource = 'budget_adjusted';
      monthlyDrCost = estimateStrategyMonthlyDrCost(
        options.monthlyProductionCost,
        selected,
        strategyContext,
      );
      rationale.push('Ajustement budget');
    }

    if (monthlyDrCost > budgetRemaining) {
      budgetWarning =
        'Budget depasse: aucune strategie inferieure disponible, verification budget recommandee';
    } else if (strategySource === 'budget_adjusted') {
      budgetWarning =
        'Budget depasse: strategie ajustee au niveau inferieur pour respecter le budget DR estime';
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
  metadata?: unknown,
): { key: IncidentProbabilityKey; probabilityAnnual: number; source: string } {
  const type = String(nodeType || '').toUpperCase();
  const meta = asMetadataRecord(metadata);
  const providerHint =
    readString(meta.provider) ??
    readString(meta.cloudProvider) ??
    readString(meta.source) ??
    null;
  const resolution = resolveCloudContext(type, providerHint, meta);
  let key: IncidentProbabilityKey = 'infrastructure';
  let probabilityAnnual = 0.1;
  let source = 'Stronghold default ARO profile';

  const providerProbability = resolveProviderIncidentProbability(resolution);
  if (providerProbability) {
    key = providerProbability.key;
    probabilityAnnual = providerProbability.probabilityAnnual;
    source = providerProbability.source;
  } else if (type === 'DATABASE') {
    key = 'database';
    probabilityAnnual = 0.05;
    source = 'Default ARO baseline for single-zone relational databases';
  } else if (type === 'THIRD_PARTY_API' || type === 'SAAS_SERVICE') {
    key = 'third_party';
    probabilityAnnual = INCIDENT_PROBABILITIES.third_party.probabilityAnnual;
    source = INCIDENT_PROBABILITIES.third_party.source;
  } else if (type === 'DNS' || type === 'LOAD_BALANCER' || type === 'API_GATEWAY') {
    key = 'dns_network';
    probabilityAnnual = INCIDENT_PROBABILITIES.dns_network.probabilityAnnual;
    source = INCIDENT_PROBABILITIES.dns_network.source;
  }

  const override = toPositiveNumber(customProbabilities?.[key]);
  return {
    key,
    probabilityAnnual: override ?? probabilityAnnual,
    source: override ? 'User-adjusted incident probability' : source,
  };
}

export function buildServiceSpecificRecommendation(options: {
  serviceName: string;
  nodeType: string;
  provider?: string | null;
  metadata?: unknown;
  strategy: DrStrategyKey;
  monthlyDrCost: number;
  currency: SupportedCurrency;
}): ServiceSpecificRecommendation {
  const metadata = asMetadataRecord(options.metadata);
  const resolution = resolveCloudContext(options.nodeType, options.provider, metadata);
  const monthlyLabel = formatMonthlyCost(options.monthlyDrCost, options.currency);
  const providerSpecific = buildProviderServiceRecommendation({
    serviceName: options.serviceName,
    monthlyLabel,
    resolution,
    strategy: options.strategy,
  });
  if (providerSpecific) {
    return providerSpecific;
  }

  if (
    resolution.category === 'serverless' ||
    (resolution.category === 'messaging' && options.monthlyDrCost <= 0.01) ||
    (resolution.category === 'storage' && options.monthlyDrCost <= 0.01)
  ) {
    const action =
      'Aucune infrastructure DR lourde requise; conserver les mecanismes natifs du service manage.';
    const resilienceImpact =
      resolution.category === 'storage'
        ? 'Optionnel: activer la replication cross-region si un objectif multi-region est requis.'
        : 'Le service est multi-AZ par conception, une optimisation de configuration suffit.';
    return {
      action,
      resilienceImpact,
      text: `${action} ${resilienceImpact} Cout additionnel estime: ${monthlyLabel}.`,
    };
  }

  const strategyLabel = DR_STRATEGY_PROFILES[options.strategy].label;
  const action = `Appliquer la strategie ${strategyLabel} sur ${options.serviceName}.`;
  const resilienceImpact =
    'Ameliore le RTO/RPO selon la criticite du service avec une approche proportionnelle.';
  return {
    action,
    resilienceImpact,
    text: `${action} ${resilienceImpact} Cout additionnel estime: ${monthlyLabel}.`,
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

  let paybackMonths =
    riskAvoidedAnnual > 0 && annualDrCost > 0
      ? roundPercent(annualDrCost / (riskAvoidedAnnual / 12))
      : null;
  let paybackLabel = classifyPaybackLabel(paybackMonths);

  if (roiPercent != null && roiPercent > 0 && paybackLabel === 'Non rentable') {
    paybackMonths =
      riskAvoidedAnnual > 0 && annualDrCost > 0
        ? roundPercent(annualDrCost / (riskAvoidedAnnual / 12))
        : null;
    paybackLabel = classifyPaybackLabel(paybackMonths);
  }
  if (roiPercent != null && roiPercent < 0 && paybackMonths != null) {
    paybackMonths = null;
    paybackLabel = 'Non rentable';
  }

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

