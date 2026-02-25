import type { PrismaClient, Prisma } from '@prisma/client';
import {
  DOWNTIME_COST_BENCHMARKS,
  REGULATORY_PENALTY_BENCHMARKS,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../constants/market-financial-data.js';
import {
  FinancialEngineService,
  type AnalysisResultInput,
  type BIAResultInput,
  type FinancialOrganizationProfileInput,
  type NodeFinancialOverrideInput,
} from './financial-engine.service.js';
import { appLogger } from '../utils/logger.js';
import { CurrencyService } from './currency.service.js';
import { buildLandingZoneFinancialContext } from './landing-zone-financial.service.js';

type InfraNodeWithEdges = Prisma.InfraNodeGetPayload<{
  include: {
    inEdges: true;
    outEdges: true;
  };
}>;

type RegulatoryNis2Entity = 'essential_entities' | 'important_entities';
type DriftStateInput = Parameters<typeof FinancialEngineService.calculateDriftFinancialImpact>[1];

export type FinancialModuleSignals = {
  discoveryCompleted: boolean;
  biaCompleted: boolean;
  simulationExecutedLast30Days: boolean;
  activeRunbookAvailable: boolean;
  praExerciseExecutedLast90Days: boolean;
  completedControls: number;
  totalControls: number;
  coverageScore: number;
};

export type RegulatoryExposureSummary = {
  profileSector: string | null;
  coverageScore: number;
  moduleSignals: FinancialModuleSignals;
  nis2: {
    applicable: boolean;
    entityType?: RegulatoryNis2Entity;
    maxFine?: string;
    complianceDeadline?: string;
    coverageScore?: number;
    benchmark?: unknown;
    source?: string;
  };
  dora: {
    applicable: boolean;
    maxFine?: string;
    complianceDeadline?: string;
    coverageScore?: number;
    benchmark?: unknown;
    source?: string;
  };
  gdpr: {
    applicable: boolean;
    benchmark: unknown;
  };
  applicableRegulations: Array<{
    id: 'nis2' | 'dora';
    label: string;
    maxFine: string;
    complianceDeadline: string;
    coverageScore: number;
    source: string;
  }>;
};

export type FinancialPrecisionBreakdownItem = {
  nodes: number;
  aleAmount: number;
  costSharePercent: number;
};

export type FinancialPrecisionSummary = {
  scorePercent: number;
  highConfidenceCostSharePercent: number;
  breakdown: {
    businessFlowValidated: FinancialPrecisionBreakdownItem;
    userOverride: FinancialPrecisionBreakdownItem;
    estimationEnriched: FinancialPrecisionBreakdownItem;
    estimationBase: FinancialPrecisionBreakdownItem;
  };
};

export type FinancialSummaryPayload = {
  metrics: {
    annualRisk: number;
    potentialSavings: number;
    roiPercent: number | null;
    paybackMonths: number | null;
  };
  totals: {
    totalSPOFs: number;
    avgDowntimeHoursPerIncident: number;
  };
  topSPOFs: Array<{
    nodeId: string;
    nodeName: string;
    nodeType: string;
    ale: number;
    probability: number;
    estimatedDowntimeHours: number;
    costPerHour: number;
    dependentsCount: number;
  }>;
  ale: ReturnType<typeof FinancialEngineService.calculateAnnualExpectedLoss>;
  roi: ReturnType<typeof FinancialEngineService.calculateROI>;
  organizationProfile: FinancialOrganizationProfileInput;
  organization: {
    id: string;
    name: string;
  };
  financialPrecision: FinancialPrecisionSummary;
  regulatoryExposure: RegulatoryExposureSummary;
  disclaimer: string;
  sources: string[];
  currency: SupportedCurrency;
  validationScope: {
    biaValidatedIncluded: number;
    biaExcludedPending: number;
  };
  generatedAt: string;
};

export type FinancialTrendPoint = {
  analysisId: string;
  scanDate: string;
  resilienceScore: number;
  ale: number;
  spofCount: number;
  criticalDriftCount: number;
  criticalDriftAdditionalRisk: number;
  annotations: Array<{
    driftId: string;
    occurredAt: string;
    label: string;
    additionalAnnualRisk: number;
    nodeName: string | null;
  }>;
};

export type FinancialTrendPayload = {
  lookbackMonths: number;
  currency: SupportedCurrency;
  points: FinancialTrendPoint[];
  hasEnoughHistory: boolean;
  message?: string;
  sources: string[];
  disclaimer: string;
  generatedAt: string;
};

const SECTOR_ALIASES: Record<string, string> = {
  retail: 'retail_ecommerce',
  retail_ecommerce: 'retail_ecommerce',
};

const NIS2_ESSENTIAL_SECTORS = new Set([
  'banking_finance',
  'healthcare',
  'energy',
  'transport',
  'water',
]);

const NIS2_IMPORTANT_SECTORS = new Set([
  'technology_saas',
  'manufacturing',
  'retail',
  'retail_ecommerce',
]);

const DEFAULT_DASHBOARD_DISCLAIMER =
  'Estimated values based on public market data and outage assumptions. Update organization profile and node overrides for higher confidence.';

function parseCurrency(rawCurrency: unknown): SupportedCurrency | undefined {
  if (typeof rawCurrency !== 'string') return undefined;
  const normalized = rawCurrency.toUpperCase();
  if ((SUPPORTED_CURRENCIES as readonly string[]).includes(normalized)) {
    return normalized as SupportedCurrency;
  }
  return undefined;
}

function normalizeVerticalSector(verticalSector: string | null | undefined): string {
  const normalized = String(verticalSector || '').trim().toLowerCase();
  if (!normalized) return '';
  return SECTOR_ALIASES[normalized] || normalized;
}

function roundAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function monthsAgo(months: number): Date {
  const now = new Date();
  const copy = new Date(now);
  copy.setMonth(copy.getMonth() - months);
  return copy;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dedupeSources(...groups: string[][]): string[] {
  const flattened = groups.flat().filter(Boolean);
  return Array.from(new Set(flattened));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function coerceBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function coerceNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mergeDriftState(
  defaults: DriftStateInput,
  rawState: Record<string, unknown>,
): DriftStateInput {
  const merged: DriftStateInput = { ...defaults };
  const isSPOF = coerceBoolean(rawState.isSPOF);
  if (isSPOF !== undefined) merged.isSPOF = isSPOF;
  const hasRedundancy = coerceBoolean(rawState.hasRedundancy);
  if (hasRedundancy !== undefined) merged.hasRedundancy = hasRedundancy;
  const rtoMinutes = coerceNumber(rawState.rtoMinutes);
  if (rtoMinutes !== undefined) merged.rtoMinutes = rtoMinutes;
  const rpoMinutes = coerceNumber(rawState.rpoMinutes);
  if (rpoMinutes !== undefined) merged.rpoMinutes = rpoMinutes;
  const inPRARegion = coerceBoolean(rawState.inPRARegion);
  if (inPRARegion !== undefined) merged.inPRARegion = inPRARegion;
  const inBIA = coerceBoolean(rawState.inBIA);
  if (inBIA !== undefined) merged.inBIA = inBIA;
  const hasBackup = coerceBoolean(rawState.hasBackup);
  if (hasBackup !== undefined) merged.hasBackup = hasBackup;
  const costPerHour = coerceNumber(rawState.costPerHour);
  if (costPerHour !== undefined) merged.costPerHour = costPerHour;
  return merged;
}

function toNodeInput(node: InfraNodeWithEdges) {
  return {
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
    dependentsCount: node.inEdges.length,
    inEdges: node.inEdges,
    outEdges: node.outEdges,
  };
}

function resolveProfile(
  profile: FinancialOrganizationProfileInput | null,
  preferredCurrency: SupportedCurrency | undefined,
): FinancialOrganizationProfileInput {
  if (!profile) {
    return {
      sizeCategory: 'midMarket',
      customCurrency: preferredCurrency || 'EUR',
    };
  }
  return preferredCurrency
    ? {
        ...profile,
        customCurrency: preferredCurrency,
      }
    : profile;
}

function resolveProbabilityFromSeverity(severity: string | null | undefined): number {
  const normalized = String(severity || '').toLowerCase();
  if (normalized === 'critical' || normalized === 'high') return 0.15;
  if (normalized === 'medium') return 0.05;
  return 0.03;
}

function extractAverageRtoHours(
  biaResult: BIAResultInput,
  fallbackHours = 4,
): number {
  const values = (biaResult.processes || [])
    .map((process) => process.validatedRTO ?? process.suggestedRTO)
    .filter((value): value is number => Number.isFinite(value as number) && Number(value) > 0)
    .map((value) => Number(value));

  if (values.length === 0) return fallbackHours;
  const avgMinutes = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number((avgMinutes / 60).toFixed(2));
}

function parseHistoricalSpofs(report: unknown): Array<{
  nodeId: string;
  nodeName: string;
  nodeType: string;
  severity: string;
  blastRadius: number;
}> {
  if (!isPlainObject(report)) return [];
  const rawSpofs = (report as Record<string, unknown>).spofs;
  if (!Array.isArray(rawSpofs)) return [];

  return rawSpofs
    .map((item) => {
      if (!isPlainObject(item)) return null;
      const nodeId = typeof item.nodeId === 'string' ? item.nodeId : '';
      const nodeName = typeof item.nodeName === 'string' ? item.nodeName : 'Unknown';
      const nodeType = typeof item.nodeType === 'string' ? item.nodeType : 'APPLICATION';
      const severity = typeof item.severity === 'string' ? item.severity : 'medium';
      const blastRadiusRaw = Number(item.blastRadius);
      const blastRadius = Number.isFinite(blastRadiusRaw) ? Math.max(1, blastRadiusRaw) : 1;
      if (!nodeId) return null;
      return {
        nodeId,
        nodeName,
        nodeType,
        severity,
        blastRadius,
      };
    })
    .filter((spof): spof is NonNullable<typeof spof> => Boolean(spof));
}

function estimateHistoricalAleFromAnalysis(options: {
  report: unknown;
  spofCount: number;
  avgRtoHours: number;
  profile: FinancialOrganizationProfileInput;
  overrideByNodeId: Map<string, NodeFinancialOverrideInput>;
}): number {
  const spofs = parseHistoricalSpofs(options.report);
  const fallbackCount = Math.max(0, options.spofCount - spofs.length);
  const syntheticSpofs = Array.from({ length: fallbackCount }).map((_, index) => ({
    nodeId: `synthetic-spof-${index}`,
    nodeName: `SPOF ${index + 1}`,
    nodeType: 'APPLICATION',
    severity: 'medium',
    blastRadius: 1,
  }));

  const allSpofs = [...spofs, ...syntheticSpofs];
  if (allSpofs.length === 0) return 0;

  const ale = allSpofs.reduce((sum, spof) => {
    const probability = resolveProbabilityFromSeverity(spof.severity);
    const nodeImpact = FinancialEngineService.calculateNodeFinancialImpact(
      {
        id: spof.nodeId,
        name: spof.nodeName,
        type: spof.nodeType,
        isSPOF: true,
        criticalityScore: 0.8,
        redundancyScore: spof.severity === 'critical' ? 0.1 : 0.35,
        dependentsCount: spof.blastRadius,
      },
      options.profile,
      options.overrideByNodeId.get(spof.nodeId),
    );
    return sum + probability * options.avgRtoHours * nodeImpact.estimatedCostPerHour;
  }, 0);

  return roundAmount(ale);
}

export async function loadFinancialContext(prismaClient: PrismaClient, tenantId: string) {
  const [nodes, latestBia, profile, overrides] = await Promise.all([
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
    prismaClient.organizationProfile.findUnique({ where: { tenantId } }),
    prismaClient.nodeFinancialOverride.findMany({ where: { tenantId } }),
  ]);

  const analysisResult: AnalysisResultInput = {
    nodes: nodes.map(toNodeInput),
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
  const nodeMetadataById = new Map<string, unknown>(
    nodes.map((node) => [node.id, node.metadata]),
  );

  return {
    analysisResult,
    biaResult,
    profile,
    overridesByNodeId,
    nodeMetadataById,
    biaValidationScope: {
      biaValidatedIncluded: validatedBiaProcesses.length,
      biaExcludedPending: Math.max(0, latestBiaProcesses.length - validatedBiaProcesses.length),
    },
  };
}

export async function computeFinancialModuleSignals(
  prismaClient: PrismaClient,
  tenantId: string,
): Promise<FinancialModuleSignals> {
  const thirtyDays = daysAgo(30);
  const ninetyDays = daysAgo(90);

  const [discoveryCount, biaCount, recentSimulationCount, activeRunbookCount, recentExerciseCount] =
    await Promise.all([
      prismaClient.infraNode.count({ where: { tenantId } }),
      prismaClient.bIAReport2.count({ where: { tenantId } }),
      prismaClient.simulation.count({
        where: {
          tenantId,
          createdAt: { gte: thirtyDays },
        },
      }),
      prismaClient.runbook.count({
        where: {
          tenantId,
          status: 'active',
        },
      }),
      prismaClient.pRAExercise.count({
        where: {
          tenantId,
          status: 'completed',
          OR: [
            { executedAt: { gte: ninetyDays } },
            { executedAt: null, updatedAt: { gte: ninetyDays } },
          ],
        },
      }),
    ]);

  const discoveryCompleted = discoveryCount > 0;
  const biaCompleted = biaCount > 0;
  const simulationExecutedLast30Days = recentSimulationCount > 0;
  const activeRunbookAvailable = activeRunbookCount > 0;
  const praExerciseExecutedLast90Days = recentExerciseCount > 0;

  const controls = [
    discoveryCompleted,
    biaCompleted,
    simulationExecutedLast30Days,
    activeRunbookAvailable,
    praExerciseExecutedLast90Days,
  ];

  const completedControls = controls.filter(Boolean).length;
  return {
    discoveryCompleted,
    biaCompleted,
    simulationExecutedLast30Days,
    activeRunbookAvailable,
    praExerciseExecutedLast90Days,
    completedControls,
    totalControls: controls.length,
    coverageScore: completedControls * 20,
  };
}

export async function buildRegulatoryExposureSummary(
  prismaClient: PrismaClient,
  tenantId: string,
  verticalSector: string | null | undefined,
): Promise<RegulatoryExposureSummary> {
  const normalizedSector = normalizeVerticalSector(verticalSector);
  const moduleSignals = await computeFinancialModuleSignals(prismaClient, tenantId);
  const coverageScore = moduleSignals.coverageScore;

  const nis2Entity: RegulatoryNis2Entity | null = NIS2_ESSENTIAL_SECTORS.has(normalizedSector)
    ? 'essential_entities'
    : NIS2_IMPORTANT_SECTORS.has(normalizedSector)
      ? 'important_entities'
      : null;

  const nis2Applicable = Boolean(nis2Entity);
  const doraApplicable = normalizedSector === 'banking_finance';

  const applicableRegulations: RegulatoryExposureSummary['applicableRegulations'] = [];

  const nis2Payload: RegulatoryExposureSummary['nis2'] = nis2Applicable
    ? {
        applicable: true,
        entityType: nis2Entity!,
        maxFine: REGULATORY_PENALTY_BENCHMARKS.nis2[nis2Entity!].maxFine,
        complianceDeadline: REGULATORY_PENALTY_BENCHMARKS.nis2.complianceDeadline,
        coverageScore,
        benchmark: REGULATORY_PENALTY_BENCHMARKS.nis2,
        source: REGULATORY_PENALTY_BENCHMARKS.nis2[nis2Entity!].source,
      }
    : { applicable: false };

  if (nis2Applicable) {
    applicableRegulations.push({
      id: 'nis2',
      label: 'NIS2',
      maxFine: nis2Payload.maxFine || REGULATORY_PENALTY_BENCHMARKS.nis2.essential_entities.maxFine,
      complianceDeadline:
        nis2Payload.complianceDeadline || REGULATORY_PENALTY_BENCHMARKS.nis2.complianceDeadline,
      coverageScore,
      source: nis2Payload.source || REGULATORY_PENALTY_BENCHMARKS.nis2.essential_entities.source,
    });
  }

  const doraPayload: RegulatoryExposureSummary['dora'] = doraApplicable
    ? {
        applicable: true,
        maxFine:
          `${REGULATORY_PENALTY_BENCHMARKS.dora.ictProviders.maxFine} ` +
          `(fournisseurs ICT critiques tiers)`,
        complianceDeadline: REGULATORY_PENALTY_BENCHMARKS.dora.applicableDate,
        coverageScore,
        benchmark: REGULATORY_PENALTY_BENCHMARKS.dora,
        source: REGULATORY_PENALTY_BENCHMARKS.dora.financialEntities.source,
      }
    : { applicable: false };

  if (doraApplicable) {
    applicableRegulations.push({
      id: 'dora',
      label: 'DORA',
      maxFine: doraPayload.maxFine || REGULATORY_PENALTY_BENCHMARKS.dora.ictProviders.maxFine,
      complianceDeadline:
        doraPayload.complianceDeadline || REGULATORY_PENALTY_BENCHMARKS.dora.applicableDate,
      coverageScore,
      source: doraPayload.source || REGULATORY_PENALTY_BENCHMARKS.dora.financialEntities.source,
    });
  }

  return {
    profileSector: normalizedSector || null,
    coverageScore,
    moduleSignals,
    nis2: nis2Payload,
    dora: doraPayload,
    gdpr: {
      applicable: true,
      benchmark: REGULATORY_PENALTY_BENCHMARKS.gdpr,
    },
    applicableRegulations,
  };
}

function hasCloudCostMetadata(rawMetadata: unknown): boolean {
  if (!isPlainObject(rawMetadata)) return false;
  const cloudCost = rawMetadata.cloudCost;
  if (!isPlainObject(cloudCost)) return false;
  const monthly = Number(cloudCost.monthlyTotalUSD);
  return Number.isFinite(monthly) && monthly > 0;
}

function buildFinancialPrecisionSummary(input: {
  ale: ReturnType<typeof FinancialEngineService.calculateAnnualExpectedLoss>;
  nodeMetadataById: Map<string, unknown>;
}): FinancialPrecisionSummary {
  const breakdownRaw = {
    businessFlowValidated: { nodes: 0, aleAmount: 0 },
    userOverride: { nodes: 0, aleAmount: 0 },
    estimationEnriched: { nodes: 0, aleAmount: 0 },
    estimationBase: { nodes: 0, aleAmount: 0 },
  };

  for (const spof of input.ale.aleBySPOF) {
    const method = String(spof.costMethod || 'legacy_estimate');
    const confidence = String(spof.costConfidence || 'low');
    const hasCloudCost = hasCloudCostMetadata(input.nodeMetadataById.get(spof.nodeId));
    const aleAmount = Number(spof.ale) || 0;

    if (method === 'business_flows' && confidence === 'high') {
      breakdownRaw.businessFlowValidated.nodes += 1;
      breakdownRaw.businessFlowValidated.aleAmount += aleAmount;
      continue;
    }
    if (method === 'user_override') {
      breakdownRaw.userOverride.nodes += 1;
      breakdownRaw.userOverride.aleAmount += aleAmount;
      continue;
    }
    if (method === 'business_flows' || (method === 'fallback_estimate' && hasCloudCost)) {
      breakdownRaw.estimationEnriched.nodes += 1;
      breakdownRaw.estimationEnriched.aleAmount += aleAmount;
      continue;
    }
    breakdownRaw.estimationBase.nodes += 1;
    breakdownRaw.estimationBase.aleAmount += aleAmount;
  }

  const totalAle =
    input.ale.totalALE > 0
      ? input.ale.totalALE
      : Object.values(breakdownRaw).reduce((sum, bucket) => sum + bucket.aleAmount, 0);

  const toBreakdownItem = (bucket: { nodes: number; aleAmount: number }): FinancialPrecisionBreakdownItem => ({
    nodes: bucket.nodes,
    aleAmount: roundAmount(bucket.aleAmount),
    costSharePercent: totalAle > 0 ? roundAmount((bucket.aleAmount / totalAle) * 100) : 0,
  });

  const breakdown = {
    businessFlowValidated: toBreakdownItem(breakdownRaw.businessFlowValidated),
    userOverride: toBreakdownItem(breakdownRaw.userOverride),
    estimationEnriched: toBreakdownItem(breakdownRaw.estimationEnriched),
    estimationBase: toBreakdownItem(breakdownRaw.estimationBase),
  };

  const highConfidenceSharePercent =
    breakdown.businessFlowValidated.costSharePercent + breakdown.userOverride.costSharePercent;

  return {
    scorePercent: highConfidenceSharePercent,
    highConfidenceCostSharePercent: highConfidenceSharePercent,
    breakdown,
  };
}

export async function buildFinancialSummaryPayload(
  prismaClient: PrismaClient,
  tenantId: string,
  options?: {
    currency?: unknown;
  },
): Promise<FinancialSummaryPayload> {
  await CurrencyService.getRates('USD');

  const preferredCurrency = parseCurrency(options?.currency);
  const [context, recommendationContext] = await Promise.all([
    loadFinancialContext(prismaClient, tenantId),
    buildLandingZoneFinancialContext(prismaClient, tenantId, {
      preferredCurrency,
    }),
  ]);

  const profile = recommendationContext.financialProfileInput;
  const ale = recommendationContext.ale;
  const roi = recommendationContext.roi;
  const annualRisk = Math.max(0, Number(ale.totalALE) || 0);
  let potentialSavings = Math.max(0, Number(roi.riskReductionAmount) || 0);
  if (potentialSavings > annualRisk) {
    appLogger.error('financial.summary.inconsistent_savings_exceeds_risk', {
      tenantId,
      annualRisk,
      potentialSavings,
    });
    potentialSavings = annualRisk;
  }
  let paybackMonths = roi.paybackMonths;
  if (
    (roi.roiPercent ?? 0) > 0 &&
    (paybackMonths == null || !Number.isFinite(paybackMonths) || paybackMonths <= 0) &&
    potentialSavings > 0 &&
    roi.annualRemediationCost > 0
  ) {
    const recalculated = roi.annualRemediationCost / (potentialSavings / 12);
    if (Number.isFinite(recalculated) && recalculated > 0) {
      paybackMonths = Math.round(recalculated * 100) / 100;
      appLogger.error('financial.summary.payback_recalculated_for_positive_roi', {
        tenantId,
        roiPercent: roi.roiPercent,
        paybackMonths,
      });
    }
  }
  if ((roi.roiPercent ?? 0) < 0 && paybackMonths != null) {
    paybackMonths = null;
  }

  const [regulatoryExposure, tenant] = await Promise.all([
    buildRegulatoryExposureSummary(prismaClient, tenantId, profile.verticalSector),
    prismaClient.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    }),
  ]);

  const financialPrecision = buildFinancialPrecisionSummary({
    ale,
    nodeMetadataById: context.nodeMetadataById,
  });

  return {
    metrics: {
      annualRisk,
      potentialSavings,
      roiPercent: roi.roiPercent,
      paybackMonths,
    },
    totals: {
      totalSPOFs: ale.totalSPOFs,
      avgDowntimeHoursPerIncident: ale.avgDowntimeHoursPerIncident,
    },
    topSPOFs: ale.aleBySPOF.slice(0, 5),
    ale,
    roi,
    organizationProfile: profile,
    organization: {
      id: tenant?.id || tenantId,
      name: tenant?.name || 'Organization',
    },
    financialPrecision,
    regulatoryExposure,
    disclaimer: DEFAULT_DASHBOARD_DISCLAIMER,
    sources: dedupeSources(ale.sources, roi.sources),
    currency: ale.currency,
    validationScope: recommendationContext.validationScope,
    generatedAt: new Date().toISOString(),
  };
}

function resolveNearestPointIndex(points: FinancialTrendPoint[], targetDate: Date): number {
  if (points.length === 0) return -1;
  const firstPoint = points[0];
  if (!firstPoint) return -1;
  let nearestIndex = 0;
  let nearestDistance = Math.abs(new Date(firstPoint.scanDate).getTime() - targetDate.getTime());

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    const distance = Math.abs(new Date(point.scanDate).getTime() - targetDate.getTime());
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

export async function buildFinancialTrendPayload(
  prismaClient: PrismaClient,
  tenantId: string,
  options?: {
    currency?: unknown;
    months?: number;
  },
): Promise<FinancialTrendPayload> {
  await CurrencyService.getRates('USD');

  const lookbackMonths = clamp(Number(options?.months || 6), 1, 24);
  const since = monthsAgo(lookbackMonths);
  const preferredCurrency = parseCurrency(options?.currency);

  const [context, analyses, drifts, nodes, overrides] = await Promise.all([
    loadFinancialContext(prismaClient, tenantId),
    prismaClient.graphAnalysis.findMany({
      where: {
        tenantId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        resilienceScore: true,
        spofCount: true,
        report: true,
      },
    }),
    prismaClient.driftEvent.findMany({
      where: {
        tenantId,
        severity: 'critical',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        nodeId: true,
        nodeName: true,
        description: true,
        severity: true,
        type: true,
        details: true,
        affectsSPOF: true,
        affectsRTO: true,
        createdAt: true,
      },
    }),
    prismaClient.infraNode.findMany({
      where: { tenantId },
      include: {
        inEdges: true,
        outEdges: true,
      },
    }),
    prismaClient.nodeFinancialOverride.findMany({
      where: { tenantId },
    }),
  ]);

  const profile = resolveProfile(context.profile, preferredCurrency);
  const overrideByNodeId = new Map<string, NodeFinancialOverrideInput>(
    overrides.map((entry) => [entry.nodeId, { customCostPerHour: entry.customCostPerHour }]),
  );

  const avgRtoHours = extractAverageRtoHours(context.biaResult, 4);

  const points: FinancialTrendPoint[] = analyses.map((analysis) => ({
    analysisId: analysis.id,
    scanDate: analysis.createdAt.toISOString(),
    resilienceScore: analysis.resilienceScore,
    ale: estimateHistoricalAleFromAnalysis({
      report: analysis.report,
      spofCount: analysis.spofCount,
      avgRtoHours,
      profile,
      overrideByNodeId,
    }),
    spofCount: analysis.spofCount,
    criticalDriftCount: 0,
    criticalDriftAdditionalRisk: 0,
    annotations: [],
  }));

  const nodeCostById = new Map<string, number>();
  for (const node of nodes) {
    const impact = FinancialEngineService.calculateNodeFinancialImpact(
      toNodeInput(node as InfraNodeWithEdges),
      profile,
      overrideByNodeId.get(node.id),
    );
    nodeCostById.set(node.id, impact.estimatedCostPerHour);
  }

  for (const drift of drifts) {
    const nearestPointIndex = resolveNearestPointIndex(points, drift.createdAt);
    if (nearestPointIndex < 0) continue;

    const details = isPlainObject(drift.details) ? drift.details : {};
    const previousState = isPlainObject(details.previousState) ? details.previousState : {};
    const currentState = isPlainObject(details.currentState) ? details.currentState : {};
    const nodeCost = drift.nodeId ? nodeCostById.get(drift.nodeId) || 500 : 500;

    const previousDefaults: DriftStateInput = {
      isSPOF: false,
      hasRedundancy: true,
      rtoMinutes: 120,
      rpoMinutes: 60,
      inPRARegion: true,
      inBIA: true,
      hasBackup: true,
      costPerHour: nodeCost,
    };

    const currentDefaults: DriftStateInput = {
      costPerHour: nodeCost,
    };
    if (drift.affectsSPOF) {
      currentDefaults.isSPOF = true;
      currentDefaults.hasRedundancy = false;
    }
    if (drift.affectsRTO) currentDefaults.rtoMinutes = 360;
    if (/region/i.test(drift.description)) currentDefaults.inPRARegion = false;
    if (/backup/i.test(drift.description)) currentDefaults.hasBackup = false;
    if (/(new service|nouveau)/i.test(drift.description)) currentDefaults.inBIA = false;

    const impact = FinancialEngineService.calculateDriftFinancialImpact(
      drift,
      mergeDriftState(previousDefaults, previousState as Record<string, unknown>),
      mergeDriftState(currentDefaults, currentState as Record<string, unknown>),
    );

    const targetPoint = points[nearestPointIndex];
    if (!targetPoint) continue;
    targetPoint.criticalDriftCount += 1;
    targetPoint.criticalDriftAdditionalRisk += impact.financialImpact.additionalAnnualRisk;
    if (targetPoint.annotations.length < 3) {
      targetPoint.annotations.push({
        driftId: drift.id,
        occurredAt: drift.createdAt.toISOString(),
        label:
          `Drift detecte: ${drift.nodeName || 'service inconnu'} ` +
          `(+${impact.financialImpact.additionalAnnualRisk.toLocaleString('fr-FR')} ${profile.customCurrency || 'EUR'}/an de risque)`,
        additionalAnnualRisk: impact.financialImpact.additionalAnnualRisk,
        nodeName: drift.nodeName || null,
      });
    }
  }

  for (const point of points) {
    point.criticalDriftAdditionalRisk = roundAmount(point.criticalDriftAdditionalRisk);
  }

  const message =
    points.length < 2
      ? 'Lancez des scans reguliers pour visualiser la tendance de votre resilience.'
      : undefined;

  return {
    lookbackMonths,
    currency: (profile.customCurrency as SupportedCurrency) || 'EUR',
    points,
    hasEnoughHistory: points.length >= 2,
    ...(message ? { message } : {}),
    sources: [
      DOWNTIME_COST_BENCHMARKS.globalStats.uptimeSource,
      DOWNTIME_COST_BENCHMARKS.enterprise.source,
      'Stronghold trend model based on historical graph analyses and critical drifts',
    ],
    disclaimer:
      'Historical ALE values are modeled estimates derived from scan history and outage assumptions. Use organization overrides for tighter calibration.',
    generatedAt: new Date().toISOString(),
  };
}

export function estimateCurrencyFxMultiplier(currency: SupportedCurrency): number {
  const rates = CurrencyService.getKnownUsdToTargetRates();
  return rates[currency] || 1;
}

