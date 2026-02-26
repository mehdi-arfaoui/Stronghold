import crypto from 'crypto';
import { Router, type NextFunction, type Response } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { requireRole } from '../middleware/tenantMiddleware.js';
import { getRedis } from '../lib/redis.js';
import { appLogger } from '../utils/logger.js';
import * as GraphService from '../graph/graphService.js';
import { generateHybridRecommendations } from '../recommendations/services/recommendation-engine.service.js';
import {
  DOWNTIME_COST_BENCHMARKS,
  NODE_TYPE_COST_MULTIPLIERS,
  ORG_SIZE_MULTIPLIERS,
  RECOVERY_STRATEGY_COSTS,
  REGULATORY_PENALTY_BENCHMARKS,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
  type VerticalSectorKey,
} from '../constants/market-financial-data.js';
import {
  FinancialEngineService,
  type AnalysisResultInput,
  type BIAResultInput,
  type FinancialOrganizationProfileInput,
  type RecommendationInput,
  type ResolvedNodeFinancialCostInput,
} from '../services/financial-engine.service.js';
import { BusinessFlowFinancialEngineService } from '../services/business-flow-financial-engine.service.js';
import {
  buildFinancialSummaryPayload,
  buildFinancialTrendPayload,
} from '../services/financial-dashboard.service.js';
import { CurrencyService } from '../services/currency.service.js';
import { resolveCompanyFinancialProfile } from '../services/company-financial-profile.service.js';
import { cloudPricingService } from '../services/pricing/cloudPricingService.js';
import { toPrismaJson } from '../utils/prismaJson.js';

const router = Router();

const FINANCIAL_CALC_MAX = 10;
const FINANCIAL_CALC_WINDOW_MS = 60 * 1000;
const CACHE_TTL_SECONDS = 60 * 60;
const cacheBuckets = new Map<string, { count: number; resetAt: number }>();
const businessFlowFinancialEngine = new BusinessFlowFinancialEngineService(prisma);

function checkCalcRateLimit(tenantId: string): boolean {
  const now = Date.now();
  const bucket = cacheBuckets.get(tenantId);
  if (!bucket || now >= bucket.resetAt) {
    cacheBuckets.set(tenantId, {
      count: 1,
      resetAt: now + FINANCIAL_CALC_WINDOW_MS,
    });
    return true;
  }

  if (bucket.count >= FINANCIAL_CALC_MAX) return false;
  bucket.count += 1;
  return true;
}

function requireCalcRateLimit(req: TenantRequest, res: Response, next: NextFunction) {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(500).json({ error: 'Tenant not resolved' });
  }

  if (!checkCalcRateLimit(tenantId)) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Maximum 10 financial calculations per minute.',
    });
  }

  return next();
}

function parseCurrency(rawCurrency: unknown): SupportedCurrency | undefined {
  if (typeof rawCurrency !== 'string') return undefined;
  const normalized = rawCurrency.toUpperCase();
  if ((SUPPORTED_CURRENCIES as readonly string[]).includes(normalized)) {
    return normalized as SupportedCurrency;
  }
  return undefined;
}

async function resolveFinancialProfileInput(
  tenantId: string,
  preferredCurrency: SupportedCurrency | undefined,
): Promise<FinancialOrganizationProfileInput> {
  const resolved = await resolveCompanyFinancialProfile(prisma, tenantId, {
    preferredCurrency,
  });
  return {
    mode: resolved.mode,
    sizeCategory: resolved.sizeCategory,
    verticalSector: resolved.verticalSector,
    industrySector: resolved.industrySector,
    employeeCount: resolved.employeeCount,
    annualRevenue: resolved.annualRevenue,
    customDowntimeCostPerHour: resolved.customDowntimeCostPerHour,
    hourlyDowntimeCost: resolved.hourlyDowntimeCost,
    annualITBudget: resolved.annualITBudget,
    drBudgetPercent: resolved.drBudgetPercent,
    customCurrency: resolved.currency,
    strongholdPlanId: resolved.strongholdPlanId,
    strongholdMonthlyCost: resolved.strongholdMonthlyCost,
    numberOfCustomers: resolved.numberOfCustomers,
    criticalBusinessHours: resolved.criticalBusinessHours,
    regulatoryConstraints: resolved.regulatoryConstraints,
    serviceOverrides: resolved.serviceOverrides,
    isConfigured: resolved.isConfigured,
  };
}

function parseNullableNumber(
  value: unknown,
  options?: { min?: number; max?: number },
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  if (options?.min != null && parsed < options.min) return undefined;
  if (options?.max != null && parsed > options.max) return undefined;
  return parsed;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) return undefined;
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function parseCriticalBusinessHours(value: unknown):
  | { start: string; end: string; timezone: string }
  | null
  | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const payload = value as Record<string, unknown>;
  const start = typeof payload.start === 'string' ? payload.start.trim() : '';
  const end = typeof payload.end === 'string' ? payload.end.trim() : '';
  const timezone = typeof payload.timezone === 'string' ? payload.timezone.trim() : '';
  if (!start || !end || !timezone) return undefined;
  return { start, end, timezone };
}

function parseServiceOverrides(value: unknown):
  | Array<{
      nodeId: string;
      customDowntimeCostPerHour?: number;
      customCriticalityTier?: 'critical' | 'high' | 'medium' | 'low';
    }>
  | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) return undefined;

  const overrides: Array<{
    nodeId: string;
    customDowntimeCostPerHour?: number;
    customCriticalityTier?: 'critical' | 'high' | 'medium' | 'low';
  }> = [];

  for (const rawItem of value) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
    const item = rawItem as Record<string, unknown>;
    const nodeId = typeof item.nodeId === 'string' ? item.nodeId.trim() : '';
    if (!nodeId) continue;
    const downtime = parseNullableNumber(item.customDowntimeCostPerHour, { min: 0 });
    const tierRaw =
      typeof item.customCriticalityTier === 'string'
        ? item.customCriticalityTier.trim().toLowerCase()
        : '';
    const tier =
      tierRaw === 'critical' || tierRaw === 'high' || tierRaw === 'medium' || tierRaw === 'low'
        ? tierRaw
        : undefined;
    overrides.push({
      nodeId,
      ...(typeof downtime === 'number' && downtime > 0 ? { customDowntimeCostPerHour: downtime } : {}),
      ...(tier ? { customCriticalityTier: tier } : {}),
    });
  }

  return overrides;
}

function normalizeProfileSource(
  value: unknown,
): 'user_input' | 'inferred' | 'hybrid' | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'user_input' || normalized === 'inferred' || normalized === 'hybrid') {
    return normalized;
  }
  return undefined;
}

type ProfileFieldSource = 'user_input' | 'suggested' | 'inferred';

const TRACKED_PROFILE_FIELDS = [
  'employeeCount',
  'annualRevenueUSD',
  'annualRevenue',
  'annualITBudget',
  'drBudgetPercent',
  'hourlyDowntimeCost',
  'customDowntimeCostPerHour',
  'industrySector',
  'verticalSector',
] as const;

type TrackedProfileField = (typeof TRACKED_PROFILE_FIELDS)[number];

function normalizeFieldSource(value: unknown): ProfileFieldSource | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'user_input' || normalized === 'suggested' || normalized === 'inferred') {
    return normalized;
  }
  return undefined;
}

function parseIncomingFieldSources(
  rawFieldSources: unknown,
  options?: { allowLegacy?: boolean },
): Partial<Record<TrackedProfileField, ProfileFieldSource>> {
  if (!rawFieldSources || typeof rawFieldSources !== 'object' || Array.isArray(rawFieldSources)) {
    return {};
  }
  const parsed: Partial<Record<TrackedProfileField, ProfileFieldSource>> = {};
  for (const field of TRACKED_PROFILE_FIELDS) {
    const normalized = normalizeFieldSource((rawFieldSources as Record<string, unknown>)[field]);
    if (!normalized) continue;
    parsed[field] = normalized;
  }
  return parsed;
}

function readStoredFieldSources(
  profileMetadata: unknown,
): Partial<Record<TrackedProfileField, ProfileFieldSource>> {
  if (!profileMetadata || typeof profileMetadata !== 'object' || Array.isArray(profileMetadata)) {
    return {};
  }
  const fieldSources = (profileMetadata as Record<string, unknown>).fieldSources;
  return parseIncomingFieldSources(fieldSources, { allowLegacy: true });
}

function buildPayloadHash(payload: unknown): string {
  const json = JSON.stringify(payload ?? {});
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

async function readCache<T>(key: string): Promise<T | null> {
  try {
    const redis = await getRedis();
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function writeCache(key: string, payload: unknown): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(payload));
  } catch {
    // Redis cache is best-effort.
  }
}

async function invalidateTenantFinancialCache(tenantId: string): Promise<void> {
  try {
    const redis = await getRedis();
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        `financial:${tenantId}:*`,
        'COUNT',
        '100',
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    appLogger.warn('financial.cache.invalidate_failed', {
      tenantId,
      error: error instanceof Error ? error.message : 'unknown_error',
    });
  }
}

async function buildTenantStateSignature(tenantId: string): Promise<string> {
  const [
    nodeMax,
    biaReport,
    graphAnalysis,
    profile,
    overrideMax,
    businessFlowMax,
    businessFlowNodeMax,
    driftMax,
    runbookMax,
    praExerciseMax,
    simulationMax,
  ] = await Promise.all([
    prisma.infraNode.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true },
    }),
    prisma.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true },
    }),
    prisma.organizationProfile.findUnique({
      where: { tenantId },
      select: { updatedAt: true },
    }),
    prisma.nodeFinancialOverride.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    prisma.businessFlow.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    prisma.businessFlowNode.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    prisma.driftEvent.aggregate({ where: { tenantId }, _max: { createdAt: true } }),
    prisma.runbook.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    prisma.pRAExercise.aggregate({ where: { tenantId }, _max: { updatedAt: true } }),
    prisma.simulation.aggregate({ where: { tenantId }, _max: { createdAt: true } }),
  ]);

  return [
    nodeMax._max.updatedAt?.toISOString() || '0',
    biaReport?.createdAt.toISOString() || '0',
    graphAnalysis?.createdAt.toISOString() || '0',
    profile?.updatedAt.toISOString() || '0',
    overrideMax._max.updatedAt?.toISOString() || '0',
    businessFlowMax._max.updatedAt?.toISOString() || '0',
    businessFlowNodeMax._max.updatedAt?.toISOString() || '0',
    driftMax._max.createdAt?.toISOString() || '0',
    runbookMax._max.updatedAt?.toISOString() || '0',
    praExerciseMax._max.updatedAt?.toISOString() || '0',
    simulationMax._max.createdAt?.toISOString() || '0',
  ].join('|');
}

async function loadFinancialContext(tenantId: string) {
  const [nodes, latestBia, profile, overrides] = await Promise.all([
    prisma.infraNode.findMany({
      where: { tenantId },
      include: {
        inEdges: true,
        outEdges: true,
      },
      orderBy: { criticalityScore: 'desc' },
    }),
    prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        processes: true,
      },
    }),
    prisma.organizationProfile.findUnique({ where: { tenantId } }),
    prisma.nodeFinancialOverride.findMany({ where: { tenantId } }),
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
  );

  return {
    analysisResult,
    biaResult,
    profile,
    overridesByNodeId,
    biaValidationScope: {
      biaValidatedIncluded: validatedBiaProcesses.length,
      biaExcludedPending: Math.max(0, latestBiaProcesses.length - validatedBiaProcesses.length),
    },
  };
}

async function buildRecommendations(tenantId: string): Promise<RecommendationInput[]> {
  const graph = await GraphService.getGraph(prisma, tenantId);
  if (graph.order === 0) return [];

  const generated = generateHybridRecommendations(graph);
  return generated.map((recommendation) => ({
    recommendationId: recommendation.id,
    targetNodes: recommendation.affectedNodeIds,
    category: recommendation.category,
    priority: recommendation.priority,
  }));
}

async function buildResolvedNodeCostsFromFlows(
  tenantId: string,
  analysisResult: AnalysisResultInput,
  profile: FinancialOrganizationProfileInput | null | undefined,
  overridesByNodeId: Awaited<ReturnType<typeof loadFinancialContext>>['overridesByNodeId'],
): Promise<{
  hasBusinessFlows: boolean;
  resolvedNodeCostsByNodeId: Record<string, ResolvedNodeFinancialCostInput>;
}> {
  const businessFlowCount = await prisma.businessFlow.count({ where: { tenantId } });
  if (businessFlowCount === 0) {
    return {
      hasBusinessFlows: false,
      resolvedNodeCostsByNodeId: {},
    };
  }

  const entries = await Promise.all(
    analysisResult.nodes.map(async (node) => {
      const flowCost = await businessFlowFinancialEngine.calculateNodeCostFromFlows({
        tenantId,
        nodeId: node.id,
        node,
        ...(profile !== undefined ? { orgProfile: profile } : {}),
        ...(overridesByNodeId[node.id] ? { override: overridesByNodeId[node.id] } : {}),
        includeUnvalidatedFlows: true,
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
              : ['Legacy financial fallback estimate'],
        } satisfies ResolvedNodeFinancialCostInput,
      ] as const;
    }),
  );

  return {
    hasBusinessFlows: true,
    resolvedNodeCostsByNodeId: Object.fromEntries(entries),
  };
}

function buildRegulatoryExposure(verticalSector: string | null | undefined) {
  const normalized = String(verticalSector || '').toLowerCase();
  const isFinance = normalized === 'banking_finance';
  const nis2Sectors = new Set([
    'banking_finance',
    'healthcare',
    'government_public',
    'media_telecom',
  ]);

  return {
    nis2: nis2Sectors.has(normalized)
      ? {
          applicable: true,
          benchmark: REGULATORY_PENALTY_BENCHMARKS.nis2,
        }
      : { applicable: false },
    dora: isFinance
      ? {
          applicable: true,
          benchmark: REGULATORY_PENALTY_BENCHMARKS.dora,
        }
      : { applicable: false },
    gdpr: {
      applicable: true,
      benchmark: REGULATORY_PENALTY_BENCHMARKS.gdpr,
    },
  };
}

router.post('/calculate-ale', requireCalcRateLimit, async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    await CurrencyService.getRates('USD');

    const stateSignature = await buildTenantStateSignature(tenantId);
    const payloadHash = buildPayloadHash(req.body);
    const cacheKey = `financial:${tenantId}:ale:${stateSignature}:${payloadHash}`;

    const cached = await readCache(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const preferredCurrency = parseCurrency(req.body?.currency);
    const [context, profile] = await Promise.all([
      loadFinancialContext(tenantId),
      resolveFinancialProfileInput(tenantId, preferredCurrency),
    ]);

    const resolved = await buildResolvedNodeCostsFromFlows(
      tenantId,
      context.analysisResult,
      profile,
      context.overridesByNodeId,
    );

    const ale = FinancialEngineService.calculateAnnualExpectedLoss(
      context.analysisResult,
      context.biaResult,
      profile,
      context.overridesByNodeId,
      resolved.resolvedNodeCostsByNodeId,
    );

    const alePayload = {
      ...ale,
      validationScope: context.biaValidationScope,
      orgProfile: {
        mode: profile?.mode ?? 'infra_only',
        sizeCategory: profile?.sizeCategory ?? 'midMarket',
        verticalSector: profile?.verticalSector ?? null,
        annualRevenue: profile?.annualRevenue ?? null,
        customCurrency: profile?.customCurrency ?? ale.currency,
        customDowntimeCostPerHour: profile?.customDowntimeCostPerHour ?? null,
        strongholdPlanId: profile?.strongholdPlanId ?? null,
        strongholdMonthlyCost: profile?.strongholdMonthlyCost ?? null,
      },
      financialPrecision: {
        businessFlowsEnabled: resolved.hasBusinessFlows,
        spofsUsingBusinessFlows: ale.aleBySPOF.filter((spof) => spof.costMethod === 'business_flows')
          .length,
        spofsUsingFallback: ale.aleBySPOF.filter(
          (spof) =>
            spof.costMethod === 'fallback_estimate' || spof.costMethod === 'legacy_estimate',
        ).length,
        spofsUsingOverrides: ale.aleBySPOF.filter((spof) => spof.costMethod === 'user_override')
          .length,
      },
    };

    await writeCache(cacheKey, alePayload);

    appLogger.info('financial.ale.calculated', {
      tenantId,
      totalALE: ale.totalALE,
      totalSPOFs: ale.totalSPOFs,
      currency: ale.currency,
      methodology: resolved.hasBusinessFlows
        ? 'business_flows_plus_benchmark_fallback'
        : 'benchmark_itic_2024_uptime_2025',
    });

    return res.json(alePayload);
  } catch (error) {
    appLogger.error('Error calculating ALE', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/calculate-roi', requireCalcRateLimit, async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    await CurrencyService.getRates('USD');

    const stateSignature = await buildTenantStateSignature(tenantId);
    const payloadHash = buildPayloadHash(req.body);
    const cacheKey = `financial:${tenantId}:roi:${stateSignature}:${payloadHash}`;

    const cached = await readCache(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const preferredCurrency = parseCurrency(req.body?.currency);
    const [context, profile] = await Promise.all([
      loadFinancialContext(tenantId),
      resolveFinancialProfileInput(tenantId, preferredCurrency),
    ]);

    const recommendations = Array.isArray(req.body?.recommendations)
      ? (req.body.recommendations as RecommendationInput[])
      : await buildRecommendations(tenantId);

    const resolved = await buildResolvedNodeCostsFromFlows(
      tenantId,
      context.analysisResult,
      profile,
      context.overridesByNodeId,
    );

    const roi = FinancialEngineService.calculateROI(
      context.analysisResult,
      context.biaResult,
      recommendations,
      profile,
      context.overridesByNodeId,
      resolved.resolvedNodeCostsByNodeId,
    );

    const roiPayload = {
      ...roi,
      validationScope: context.biaValidationScope,
    };

    await writeCache(cacheKey, roiPayload);

    appLogger.info('financial.roi.calculated', {
      tenantId,
      currentALE: roi.currentALE,
      projectedALE: roi.projectedALE,
      roiPercent: roi.roiPercent,
      recommendationCount: recommendations.length,
      methodology: 'stronghold_financial_engine_v1',
    });

    return res.json(roiPayload);
  } catch (error) {
    appLogger.error('Error calculating ROI', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/node/:nodeId/flow-impact', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    await CurrencyService.getRates('USD');

    const nodeId = req.params.nodeId;
    if (!nodeId) return res.status(400).json({ error: 'nodeId is required' });

    const [node, profile, override] = await Promise.all([
      prisma.infraNode.findFirst({
        where: { id: nodeId, tenantId },
        include: { inEdges: true, outEdges: true },
      }),
      prisma.organizationProfile.findUnique({ where: { tenantId } }),
      prisma.nodeFinancialOverride.findUnique({
        where: {
          nodeId_tenantId: {
            nodeId,
            tenantId,
          },
        },
      }),
    ]);

    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const flowImpact = await businessFlowFinancialEngine.calculateNodeCostFromFlows({
      tenantId,
      nodeId: node.id,
      node: {
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
      },
      orgProfile: profile,
      ...(override ? { override: { customCostPerHour: override.customCostPerHour } } : {}),
      includeUnvalidatedFlows: true,
      applyCloudCostFactor: true,
    });

    return res.json({
      node: {
        id: node.id,
        name: node.name,
        type: node.type,
        provider: node.provider,
      },
      flowImpact,
      currency: flowImpact.currency,
      precisionBadge:
        flowImpact.method === 'user_override'
          ? 'override_user'
          : flowImpact.method === 'business_flows'
            ? flowImpact.confidence === 'high'
              ? 'business_flow_validated'
              : 'business_flow_not_validated'
            : flowImpact.fallbackEstimate != null
              ? 'estimation_enriched_or_base'
              : 'estimation_base',
    });
  } catch (error) {
    appLogger.error('Error calculating flow-based node impact', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/flows-coverage', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const [coverage, totalFlows, validatedFlows] = await Promise.all([
      businessFlowFinancialEngine.calculateFlowsCoverage(tenantId),
      prisma.businessFlow.count({ where: { tenantId } }),
      prisma.businessFlow.count({ where: { tenantId, validatedByUser: true } }),
    ]);

    return res.json({
      ...coverage,
      totalFlows,
      validatedFlows,
      unvalidatedFlows: Math.max(0, totalFlows - validatedFlows),
    });
  } catch (error) {
    appLogger.error('Error calculating business flow coverage', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/node/:nodeId/impact', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    await CurrencyService.getRates('USD');

    const nodeId = req.params.nodeId;
    if (!nodeId) return res.status(400).json({ error: 'nodeId is required' });

    const [node, profile, override] = await Promise.all([
      prisma.infraNode.findFirst({
        where: { id: nodeId, tenantId },
        include: { inEdges: true, outEdges: true },
      }),
      prisma.organizationProfile.findUnique({ where: { tenantId } }),
      prisma.nodeFinancialOverride.findUnique({
        where: {
          nodeId_tenantId: {
            nodeId,
            tenantId,
          },
        },
      }),
    ]);

    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const impact = FinancialEngineService.calculateNodeFinancialImpact(
      {
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
      },
      profile,
      override ? { customCostPerHour: override.customCostPerHour } : undefined,
    );

    return res.json({
      node: {
        id: node.id,
        name: node.name,
        type: node.type,
        provider: node.provider,
      },
      impact,
      disclaimer:
        'Estimated values based on public market benchmarks. Override this node value with business-owned data when available.',
    });
  } catch (error) {
    appLogger.error('Error calculating node financial impact', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/drift/:driftId/impact', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    await CurrencyService.getRates('USD');

    const driftId = req.params.driftId;
    if (!driftId) return res.status(400).json({ error: 'driftId is required' });

    const drift = await prisma.driftEvent.findFirst({
      where: { id: driftId, tenantId },
    });

    if (!drift) {
      return res.status(404).json({ error: 'Drift event not found' });
    }

    const node = drift.nodeId
      ? await prisma.infraNode.findFirst({
          where: { id: drift.nodeId, tenantId },
          include: { inEdges: true, outEdges: true },
        })
      : null;

    const profile = await prisma.organizationProfile.findUnique({ where: { tenantId } });
    const override = drift.nodeId
      ? await prisma.nodeFinancialOverride.findUnique({
          where: { nodeId_tenantId: { nodeId: drift.nodeId, tenantId } },
        })
      : null;

    const nodeImpact = node
      ? FinancialEngineService.calculateNodeFinancialImpact(
          {
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
          },
          profile,
          override ? { customCostPerHour: override.customCostPerHour } : undefined,
        )
      : null;

    const previousState = {
      ...(typeof req.body?.previousState === 'object' && req.body.previousState
        ? req.body.previousState
        : {}),
      costPerHour: nodeImpact?.estimatedCostPerHour ?? req.body?.previousState?.costPerHour,
    };

    const currentState = {
      ...(typeof req.body?.currentState === 'object' && req.body.currentState
        ? req.body.currentState
        : {}),
      costPerHour: nodeImpact?.estimatedCostPerHour ?? req.body?.currentState?.costPerHour,
    };

    const impact = FinancialEngineService.calculateDriftFinancialImpact(
      {
        id: drift.id,
        type: drift.type,
        severity: drift.severity,
        description: drift.description,
        details: drift.details,
        affectsSPOF: drift.affectsSPOF,
        affectsRTO: drift.affectsRTO,
      },
      previousState,
      currentState,
    );

    const currency = nodeImpact?.breakdown.currency || String(profile?.customCurrency || 'EUR').toUpperCase();
    return res.json({
      ...impact,
      currency,
    });
  } catch (error) {
    appLogger.error('Error calculating drift impact', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/summary', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    await CurrencyService.getRates('USD');

    const stateSignature = await buildTenantStateSignature(tenantId);
    const payloadHash = buildPayloadHash({ currency: req.query.currency });
    const cacheKey = `financial:${tenantId}:summary:${stateSignature}:${payloadHash}`;

    const cached = await readCache(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const summary = await buildFinancialSummaryPayload(prisma, tenantId, {
      currency: req.query.currency,
    });

    await writeCache(cacheKey, summary);
    return res.json(summary);
  } catch (error) {
    appLogger.error('Error building financial summary', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/trend', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    await CurrencyService.getRates('USD');

    const monthsRaw = Number(req.query.months);
    const months =
      Number.isFinite(monthsRaw) && monthsRaw > 0
        ? Math.min(24, Math.max(1, Math.floor(monthsRaw)))
        : 6;

    const stateSignature = await buildTenantStateSignature(tenantId);
    const payloadHash = buildPayloadHash({ currency: req.query.currency, months });
    const cacheKey = `financial:${tenantId}:trend:${stateSignature}:${payloadHash}`;

    const cached = await readCache(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const trend = await buildFinancialTrendPayload(prisma, tenantId, {
      currency: req.query.currency,
      months,
    });

    await writeCache(cacheKey, trend);
    return res.json(trend);
  } catch (error) {
    appLogger.error('Error building financial trend', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/pricing/health', requireRole('READER'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
    if (refresh && !checkCalcRateLimit(tenantId)) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Maximum 10 pricing health refreshes per minute.',
      });
    }

    const status = refresh
      ? await cloudPricingService.runConnectivitySelfTest()
      : cloudPricingService.getConnectivityStatus();

    return res.json({
      ...status,
      refreshed: refresh,
      checkedByTenantId: tenantId,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    appLogger.error('Error building pricing health status', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/org-profile', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const [profile, resolved] = await Promise.all([
      prisma.organizationProfile.findUnique({ where: { tenantId } }),
      resolveCompanyFinancialProfile(prisma, tenantId, {
        preferredCurrency: req.query.currency,
      }),
    ]);
    const annualRevenueUsd =
      profile?.annualRevenueUSD ??
      (resolved.annualRevenue
        ? CurrencyService.convertAmount(resolved.annualRevenue, resolved.currency, 'USD')
        : null);
    return res.json({
      tenantId,
      mode: resolved.mode,
      sizeCategory: resolved.sizeCategory,
      verticalSector: profile?.verticalSector ?? null,
      employeeCount: resolved.employeeCount,
      annualRevenueUSD: annualRevenueUsd ? Math.round(annualRevenueUsd) : null,
      annualRevenue: resolved.annualRevenue,
      industrySector: resolved.industrySector,
      annualITBudget: resolved.annualITBudget,
      drBudgetPercent: resolved.drBudgetPercent,
      hourlyDowntimeCost: resolved.hourlyDowntimeCost,
      customDowntimeCostPerHour: resolved.customDowntimeCostPerHour,
      customCurrency: resolved.currency,
      strongholdPlanId: resolved.strongholdPlanId,
      strongholdMonthlyCost: resolved.strongholdMonthlyCost,
      numberOfCustomers: resolved.numberOfCustomers,
      criticalBusinessHours: resolved.criticalBusinessHours,
      regulatoryConstraints: resolved.regulatoryConstraints,
      serviceOverrides: resolved.serviceOverrides,
      isConfigured: resolved.isConfigured,
      profileSource: resolved.source,
      profileConfidence: resolved.confidence,
      sourceDisclaimer: resolved.sourceDisclaimer,
      inferenceBanner: resolved.inferenceBanner,
      reviewBanner: resolved.reviewBanner,
      requiresReview: resolved.requiresReview,
      fieldSources: resolved.fieldSources,
      estimatedDrBudgetAnnual: resolved.estimatedDrBudgetAnnual,
    });
  } catch (error) {
    appLogger.error('Error fetching organization profile', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/org-profile', requireRole('OPERATOR'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    await CurrencyService.getRates('USD');

    const sizeCategoryRaw = req.body?.sizeCategory;
    const sizeCategory =
      typeof sizeCategoryRaw === 'string' && sizeCategoryRaw in ORG_SIZE_MULTIPLIERS
        ? sizeCategoryRaw
        : undefined;

    const existingProfile = await prisma.organizationProfile.findUnique({ where: { tenantId } });
    const currency =
      parseCurrency(req.body?.customCurrency) ||
      parseCurrency(existingProfile?.customCurrency) ||
      'EUR';

    const employeeCountInput = parseNullableNumber(req.body?.employeeCount, { min: 0 });
    const annualRevenueUsdInput = parseNullableNumber(req.body?.annualRevenueUSD, { min: 0 });
    const annualRevenueInput = parseNullableNumber(req.body?.annualRevenue, { min: 0 });
    const annualItBudgetInput = parseNullableNumber(req.body?.annualITBudget, { min: 0 });
    const drBudgetPercentInput = parseNullableNumber(req.body?.drBudgetPercent, { min: 0, max: 100 });
    const hourlyDowntimeCostInput = parseNullableNumber(req.body?.hourlyDowntimeCost, { min: 0 });
    const legacyDowntimeInput = parseNullableNumber(req.body?.customDowntimeCostPerHour, { min: 0 });
    const strongholdMonthlyCostInput = parseNullableNumber(req.body?.strongholdMonthlyCost, { min: 0 });
    const numberOfCustomersInput = parseNullableNumber(req.body?.numberOfCustomers, { min: 0 });
    const criticalBusinessHoursInput = parseCriticalBusinessHours(req.body?.criticalBusinessHours);
    const regulatoryConstraintsInput = parseStringArray(req.body?.regulatoryConstraints);
    const serviceOverridesInput = parseServiceOverrides(req.body?.serviceOverrides);
    const profileConfidenceInput = parseNullableNumber(req.body?.profileConfidence, { min: 0, max: 1 });
    const incomingFieldSources = parseIncomingFieldSources(req.body?.fieldSources);
    const existingFieldSources = readStoredFieldSources(existingProfile?.profileMetadata);
    const existingNormalizedProfileSource = normalizeProfileSource(existingProfile?.profileSource) ?? 'inferred';
    if (
      Object.keys(existingFieldSources).length === 0 &&
      existingProfile &&
      (existingNormalizedProfileSource === 'user_input' || existingNormalizedProfileSource === 'hybrid')
    ) {
      if (existingProfile.employeeCount != null) existingFieldSources.employeeCount = 'user_input';
      if (existingProfile.annualRevenueUSD != null) existingFieldSources.annualRevenueUSD = 'user_input';
      if (existingProfile.annualRevenue != null) existingFieldSources.annualRevenue = 'user_input';
      if (existingProfile.hourlyDowntimeCost != null) existingFieldSources.hourlyDowntimeCost = 'user_input';
      if (existingProfile.customDowntimeCostPerHour != null) {
        existingFieldSources.customDowntimeCostPerHour = 'user_input';
      }
      if (existingProfile.industrySector) existingFieldSources.industrySector = 'user_input';
      if (existingProfile.verticalSector) existingFieldSources.verticalSector = 'user_input';
    }

    const revenueFromAnnual =
      annualRevenueInput != null
        ? CurrencyService.convertAmount(annualRevenueInput, currency, 'USD')
        : undefined;
    const annualRevenueUsdResolved =
      annualRevenueUsdInput !== undefined
        ? annualRevenueUsdInput
        : revenueFromAnnual !== undefined
          ? revenueFromAnnual
          : undefined;

    const verticalSectorInput =
      req.body?.verticalSector === null
        ? null
        : typeof req.body?.verticalSector === 'string'
          ? req.body.verticalSector
          : undefined;
    const industrySectorInput =
      req.body?.industrySector === null
        ? null
        : typeof req.body?.industrySector === 'string'
          ? req.body.industrySector
          : undefined;
    const hourlyDowntimeCostResolvedInput =
      hourlyDowntimeCostInput !== undefined
        ? hourlyDowntimeCostInput
        : legacyDowntimeInput !== undefined
          ? legacyDowntimeInput
          : undefined;
    const customDowntimeResolvedInput =
      legacyDowntimeInput !== undefined
        ? legacyDowntimeInput
        : hourlyDowntimeCostInput !== undefined
          ? hourlyDowntimeCostInput
          : undefined;

    const appliedFieldValues: Partial<Record<TrackedProfileField, unknown>> = {};
    const mergedFieldSources: Partial<Record<TrackedProfileField, ProfileFieldSource>> = {
      ...existingFieldSources,
    };
    const appliedUserInputFields: TrackedProfileField[] = [];

    const applyTrackedField = (field: TrackedProfileField, value: unknown) => {
      if (value === undefined) return;
      const incomingSource: ProfileFieldSource = incomingFieldSources[field] ?? 'user_input';
      if (incomingSource !== 'user_input') return;
      appliedFieldValues[field] = value;
      mergedFieldSources[field] = incomingSource;
      appliedUserInputFields.push(field);
    };

    applyTrackedField('employeeCount', employeeCountInput);
    applyTrackedField('annualRevenueUSD', annualRevenueUsdResolved);
    applyTrackedField('annualRevenue', annualRevenueInput);
    applyTrackedField('annualITBudget', annualItBudgetInput);
    applyTrackedField('drBudgetPercent', drBudgetPercentInput);
    applyTrackedField('hourlyDowntimeCost', hourlyDowntimeCostResolvedInput);
    applyTrackedField('customDowntimeCostPerHour', customDowntimeResolvedInput);
    applyTrackedField('industrySector', industrySectorInput);
    applyTrackedField('verticalSector', verticalSectorInput);

    const userProvidedFinancialFields = appliedUserInputFields.length > 0;
    const resolvedProfileSource = userProvidedFinancialFields
      ? 'user_input'
      : existingNormalizedProfileSource;
    const resolvedProfileConfidence =
      profileConfidenceInput ??
      (userProvidedFinancialFields ? 0.95 : undefined);

    const existingMetadata =
      existingProfile?.profileMetadata &&
      typeof existingProfile.profileMetadata === 'object' &&
      !Array.isArray(existingProfile.profileMetadata)
        ? (existingProfile.profileMetadata as Record<string, unknown>)
        : {};
    const nowIso = new Date().toISOString();
    const mergedMetadata: Record<string, unknown> = {
      ...existingMetadata,
      fieldSources: mergedFieldSources,
      lastProfileUpdateAt: nowIso,
      hasUserOverrides: userProvidedFinancialFields || Boolean(existingMetadata.hasUserOverrides),
    };
    if (userProvidedFinancialFields) {
      mergedMetadata.lastManualUpdateAt = nowIso;
    }
    if (numberOfCustomersInput !== undefined) {
      mergedMetadata.numberOfCustomers = numberOfCustomersInput;
    }
    if (criticalBusinessHoursInput !== undefined) {
      mergedMetadata.criticalBusinessHours = criticalBusinessHoursInput;
    }
    if (regulatoryConstraintsInput !== undefined) {
      mergedMetadata.regulatoryConstraints = regulatoryConstraintsInput;
    }
    if (serviceOverridesInput !== undefined) {
      mergedMetadata.serviceOverrides = serviceOverridesInput;
    }
    const mergedMetadataJson = toPrismaJson(mergedMetadata);

    const profile = await prisma.organizationProfile.upsert({
      where: { tenantId },
      create: {
        tenantId,
        sizeCategory: sizeCategory || 'midMarket',
        verticalSector:
          appliedFieldValues.verticalSector !== undefined
            ? (appliedFieldValues.verticalSector as string | null)
            : null,
        employeeCount:
          appliedFieldValues.employeeCount !== undefined
            ? (appliedFieldValues.employeeCount as number | null)
            : null,
        annualRevenueUSD:
          appliedFieldValues.annualRevenueUSD !== undefined
            ? (appliedFieldValues.annualRevenueUSD as number | null)
            : null,
        annualRevenue:
          appliedFieldValues.annualRevenue !== undefined
            ? (appliedFieldValues.annualRevenue as number | null)
            : null,
        industrySector:
          appliedFieldValues.industrySector !== undefined
            ? (appliedFieldValues.industrySector as string | null)
            : null,
        annualITBudget:
          appliedFieldValues.annualITBudget !== undefined
            ? (appliedFieldValues.annualITBudget as number | null)
            : null,
        drBudgetPercent:
          appliedFieldValues.drBudgetPercent !== undefined
            ? (appliedFieldValues.drBudgetPercent as number | null)
            : null,
        hourlyDowntimeCost:
          appliedFieldValues.hourlyDowntimeCost !== undefined
            ? (appliedFieldValues.hourlyDowntimeCost as number | null)
            : null,
        customDowntimeCostPerHour:
          appliedFieldValues.customDowntimeCostPerHour !== undefined
            ? (appliedFieldValues.customDowntimeCostPerHour as number | null)
            : null,
        customCurrency: currency,
        profileSource: resolvedProfileSource ?? 'user_input',
        profileConfidence: resolvedProfileConfidence ?? 0.95,
        profileMetadata: mergedMetadataJson,
        strongholdPlanId:
          typeof req.body?.strongholdPlanId === 'string'
            ? req.body.strongholdPlanId
            : null,
        strongholdMonthlyCost: strongholdMonthlyCostInput ?? null,
      },
      update: {
        ...(sizeCategory ? { sizeCategory } : {}),
        ...(appliedFieldValues.verticalSector !== undefined
          ? { verticalSector: appliedFieldValues.verticalSector as string | null }
          : {}),
        ...(appliedFieldValues.employeeCount !== undefined
          ? { employeeCount: appliedFieldValues.employeeCount as number | null }
          : {}),
        ...(appliedFieldValues.annualRevenueUSD !== undefined
          ? { annualRevenueUSD: appliedFieldValues.annualRevenueUSD as number | null }
          : {}),
        ...(appliedFieldValues.annualRevenue !== undefined
          ? { annualRevenue: appliedFieldValues.annualRevenue as number | null }
          : {}),
        ...(appliedFieldValues.industrySector !== undefined
          ? { industrySector: appliedFieldValues.industrySector as string | null }
          : {}),
        ...(appliedFieldValues.annualITBudget !== undefined
          ? { annualITBudget: appliedFieldValues.annualITBudget as number | null }
          : {}),
        ...(appliedFieldValues.drBudgetPercent !== undefined
          ? { drBudgetPercent: appliedFieldValues.drBudgetPercent as number | null }
          : {}),
        ...(appliedFieldValues.hourlyDowntimeCost !== undefined
          ? { hourlyDowntimeCost: appliedFieldValues.hourlyDowntimeCost as number | null }
          : {}),
        ...(appliedFieldValues.customDowntimeCostPerHour !== undefined
          ? {
              customDowntimeCostPerHour:
                appliedFieldValues.customDowntimeCostPerHour as number | null,
            }
            : {}),
        ...(currency ? { customCurrency: currency } : {}),
        ...(resolvedProfileSource ? { profileSource: resolvedProfileSource } : {}),
        ...(resolvedProfileConfidence != null
          ? { profileConfidence: resolvedProfileConfidence }
          : {}),
        ...(Object.keys(appliedFieldValues).length > 0 ||
        resolvedProfileSource ||
        numberOfCustomersInput !== undefined ||
        criticalBusinessHoursInput !== undefined ||
        regulatoryConstraintsInput !== undefined ||
        serviceOverridesInput !== undefined
          ? {
              profileMetadata: mergedMetadataJson,
            }
          : {}),
        ...(typeof req.body?.strongholdPlanId === 'string'
          ? { strongholdPlanId: req.body.strongholdPlanId }
          : {}),
        ...(strongholdMonthlyCostInput !== undefined
          ? { strongholdMonthlyCost: strongholdMonthlyCostInput }
          : {}),
      },
    });

    await invalidateTenantFinancialCache(tenantId);
    appLogger.info('financial.org_profile.updated', {
      tenantId,
      sizeCategory: profile.sizeCategory,
      customCurrency: profile.customCurrency,
      cacheInvalidated: true,
    });

    return res.json(profile);
  } catch (error) {
    appLogger.error('Error updating organization profile', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/node/:nodeId/override', requireRole('OPERATOR'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const nodeId = req.params.nodeId;
    if (!nodeId) return res.status(400).json({ error: 'nodeId is required' });

    const customCostPerHour = Number(req.body?.customCostPerHour);
    if (!Number.isFinite(customCostPerHour) || customCostPerHour <= 0) {
      return res.status(400).json({ error: 'customCostPerHour must be a positive number' });
    }

    const node = await prisma.infraNode.findFirst({ where: { id: nodeId, tenantId } });
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const override = await prisma.nodeFinancialOverride.upsert({
      where: {
        nodeId_tenantId: {
          nodeId,
          tenantId,
        },
      },
      create: {
        nodeId,
        tenantId,
        customCostPerHour,
        justification:
          typeof req.body?.justification === 'string' ? req.body.justification : null,
        validatedBy:
          typeof req.body?.validatedBy === 'string' ? req.body.validatedBy : null,
        validatedAt:
          typeof req.body?.validatedBy === 'string' && req.body.validatedBy.length > 0
            ? new Date()
            : null,
      },
      update: {
        customCostPerHour,
        ...(typeof req.body?.justification === 'string'
          ? { justification: req.body.justification }
          : {}),
        ...(typeof req.body?.validatedBy === 'string'
          ? { validatedBy: req.body.validatedBy, validatedAt: new Date() }
          : {}),
      },
    });

    await invalidateTenantFinancialCache(tenantId);

    return res.json(override);
  } catch (error) {
    appLogger.error('Error upserting node financial override', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/benchmarks', (_req, res) => {
  return res.json({
    downtime: DOWNTIME_COST_BENCHMARKS,
    regulatory: REGULATORY_PENALTY_BENCHMARKS,
    recoveryStrategies: RECOVERY_STRATEGY_COSTS,
    nodeTypeMultipliers: NODE_TYPE_COST_MULTIPLIERS,
    organizationMultipliers: ORG_SIZE_MULTIPLIERS,
    supportedCurrencies: SUPPORTED_CURRENCIES,
    disclaimer:
      'Market benchmark defaults only. Replace with organization-specific values for financial governance.',
  });
});

router.get('/benchmarks/vertical/:sector', (req, res) => {
  const sector = req.params.sector as VerticalSectorKey;
  if (!(sector in DOWNTIME_COST_BENCHMARKS.byVertical)) {
    return res.status(404).json({ error: `Unknown sector: ${req.params.sector}` });
  }

  return res.json({
    sector,
    benchmark: DOWNTIME_COST_BENCHMARKS.byVertical[sector],
    source: DOWNTIME_COST_BENCHMARKS.byVertical[sector].source,
  });
});

export default router;

