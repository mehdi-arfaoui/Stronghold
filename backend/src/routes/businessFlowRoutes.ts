import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { requireRole } from '../middleware/tenantMiddleware.js';
import { appLogger } from '../utils/logger.js';
import {
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../constants/market-financial-data.js';
import {
  buildValidationError,
  parseOptionalBoolean,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
  type ValidationIssue,
} from '../validation/common.js';
import {
  BusinessFlowFinancialEngineService,
} from '../services/business-flow-financial-engine.service.js';
import { CloudEnrichmentService } from '../services/cloud-enrichment.service.js';
import { AIFlowSuggesterService, type FlowSuggestion } from '../services/ai-flow-suggester.service.js';
import { CurrencyService } from '../services/currency.service.js';

const router = Router();
const businessFlowFinancialEngine = new BusinessFlowFinancialEngineService(prisma);
const cloudEnrichmentService = new CloudEnrichmentService(prisma);
const aiFlowSuggesterService = new AIFlowSuggesterService(prisma);

const AI_SUGGESTION_MAX_PER_HOUR = 5;
const AI_SUGGESTION_WINDOW_MS = 60 * 60 * 1000;
const aiSuggestionBuckets = new Map<string, { count: number; resetAt: number }>();

type AISuggestionInsight = {
  flowId: string;
  label: string;
  proposedAction: string;
  rationale: string;
  suggestedServicesToAdd: Array<{
    nodeId: string;
    nodeName: string;
    reason: string;
  }>;
  optimizationHints: string[];
  spofAlerts: string[];
};

function isAllowedAICategory(value: string): boolean {
  return ['revenue', 'operations', 'compliance', 'internal'].includes(value);
}

function checkAISuggestionRateLimit(tenantId: string): boolean {
  const now = Date.now();
  const bucket = aiSuggestionBuckets.get(tenantId);
  if (!bucket || now >= bucket.resetAt) {
    aiSuggestionBuckets.set(tenantId, {
      count: 1,
      resetAt: now + AI_SUGGESTION_WINDOW_MS,
    });
    return true;
  }
  if (bucket.count >= AI_SUGGESTION_MAX_PER_HOUR) return false;
  bucket.count += 1;
  return true;
}

function buildAISuggestionInsights(input: {
  suggestions: FlowSuggestion[];
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    isSPOF: boolean;
    criticalityScore: number | null;
    redundancyScore: number | null;
  }>;
  edges: Array<{ sourceId: string; targetId: string }>;
}): AISuggestionInsight[] {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  return input.suggestions.map((suggestion) => {
    const suggestionNodeIds = new Set(suggestion.nodes.map((node) => node.nodeId));
    const addCandidates = new Map<string, { nodeId: string; nodeName: string; reason: string }>();

    for (const edge of input.edges) {
      const sourceInFlow = suggestionNodeIds.has(edge.sourceId);
      const targetInFlow = suggestionNodeIds.has(edge.targetId);
      if (sourceInFlow === targetInFlow) continue;

      const candidateId = sourceInFlow ? edge.targetId : edge.sourceId;
      if (suggestionNodeIds.has(candidateId)) continue;
      const candidateNode = nodeById.get(candidateId);
      if (!candidateNode) continue;
      const reason = sourceInFlow
        ? `Dependance detectee depuis un service du flux (${edge.sourceId} -> ${edge.targetId})`
        : `Service amont detecte dans le graphe (${edge.sourceId} -> ${edge.targetId})`;
      addCandidates.set(candidateId, {
        nodeId: candidateId,
        nodeName: candidateNode.name,
        reason,
      });
    }

    const suggestedServicesToAdd = Array.from(addCandidates.values())
      .sort((left, right) => {
        const leftNode = nodeById.get(left.nodeId);
        const rightNode = nodeById.get(right.nodeId);
        const leftSpof = leftNode?.isSPOF ? 1 : 0;
        const rightSpof = rightNode?.isSPOF ? 1 : 0;
        if (leftSpof !== rightSpof) return rightSpof - leftSpof;
        const leftScore = Number(leftNode?.criticalityScore || 0);
        const rightScore = Number(rightNode?.criticalityScore || 0);
        if (leftScore !== rightScore) return rightScore - leftScore;
        return left.nodeName.localeCompare(right.nodeName);
      })
      .slice(0, 4);

    const spofAlerts = suggestion.nodes
      .map((node) => nodeById.get(node.nodeId))
      .filter((node): node is NonNullable<typeof node> => Boolean(node && node.isSPOF))
      .map((node) => `${node.name} est un SPOF dans ce flux`);

    const lowRedundancyCount = suggestion.nodes
      .map((node) => nodeById.get(node.nodeId))
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
      .filter((node) => Number(node.redundancyScore || 0) < 0.4).length;

    const optimizationHints: string[] = [];
    if (suggestedServicesToAdd.length > 0) {
      optimizationHints.push('Completer le flux avec les dependances detectees dans le graphe');
    }
    if (lowRedundancyCount > 0) {
      optimizationHints.push('Renforcer la redondance sur les maillons critiques du chemin');
    }
    if (suggestion.nodes.length >= 5) {
      optimizationHints.push('Verifier le chemin critique: flux long avec propagation potentielle');
    }
    if (spofAlerts.length > 0) {
      optimizationHints.push('Prioriser le traitement des SPOF avant validation finale');
    }

    return {
      flowId: suggestion.flowId,
      label: suggestion.name,
      proposedAction:
        suggestedServicesToAdd.length > 0
          ? 'Valider ce flux puis ajouter les services suggeres'
          : 'Valider ou rejeter ce flux suggere',
      rationale: suggestion.reasoning || 'Suggestion basee sur dependances detectees',
      suggestedServicesToAdd,
      optimizationHints,
      spofAlerts,
    };
  });
}

function parseHour(value: unknown, field: string, issues: ValidationIssue[]): number | null | undefined {
  const parsed = parseOptionalNumber(value, field, issues, { allowNull: true, min: 0 });
  if (parsed === undefined || parsed === null) return parsed;
  if (!Number.isInteger(parsed) || parsed > 23) {
    issues.push({ field, message: 'doit Ãªtre un entier entre 0 et 23' });
    return undefined;
  }
  return parsed;
}

function parseBoundedInt(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
  bounds: { min: number; max: number; allowNull?: boolean },
): number | null | undefined {
  const parsed = parseOptionalNumber(
    value,
    field,
    issues,
    bounds.allowNull === true ? { allowNull: true, min: bounds.min } : { min: bounds.min },
  );
  if (parsed === undefined || parsed === null) return parsed;
  if (!Number.isInteger(parsed) || parsed > bounds.max) {
    issues.push({ field, message: `doit Ãªtre un entier entre ${bounds.min} et ${bounds.max}` });
    return undefined;
  }
  return parsed;
}

function parseOptionalCategory(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
): string | null | undefined {
  const parsed = parseOptionalString(value, field, issues, { allowNull: true, maxLength: 64 });
  if (parsed === undefined || parsed === null) return parsed;
  const normalized = parsed.toLowerCase();
  if (!isAllowedAICategory(normalized)) {
    issues.push({ field, message: 'doit Ãªtre revenue|operations|compliance|internal' });
    return undefined;
  }
  return normalized;
}

function parseFlowInput(payload: Record<string, unknown>, isPatch: boolean): {
  issues: ValidationIssue[];
  data: Record<string, unknown>;
} {
  const issues: ValidationIssue[] = [];
  const data: Record<string, unknown> = {};

  if (!isPatch) {
    const name = parseRequiredString(payload.name, 'name', issues, { minLength: 2, maxLength: 120 });
    if (name !== undefined) data.name = name;
  } else {
    const name = parseOptionalString(payload.name, 'name', issues, { allowNull: false, minLength: 2, maxLength: 120 });
    if (name !== undefined && name !== null) data.name = name;
  }

  const description = parseOptionalString(payload.description, 'description', issues, {
    allowNull: true,
    maxLength: 1000,
  });
  if (description !== undefined) data.description = description;

  const category = parseOptionalCategory(payload.category, 'category', issues);
  if (category !== undefined) data.category = category;

  const annualRevenue = parseOptionalNumber(payload.annualRevenue, 'annualRevenue', issues, {
    allowNull: true,
    min: 0,
  });
  if (annualRevenue !== undefined) data.annualRevenue = annualRevenue;

  const transactionsPerHour = parseOptionalNumber(
    payload.transactionsPerHour,
    'transactionsPerHour',
    issues,
    { allowNull: true, min: 0 },
  );
  if (transactionsPerHour !== undefined) data.transactionsPerHour = transactionsPerHour;

  const revenuePerTransaction = parseOptionalNumber(
    payload.revenuePerTransaction,
    'revenuePerTransaction',
    issues,
    { allowNull: true, min: 0 },
  );
  if (revenuePerTransaction !== undefined) data.revenuePerTransaction = revenuePerTransaction;

  const estimatedCostPerHour = parseOptionalNumber(
    payload.estimatedCostPerHour,
    'estimatedCostPerHour',
    issues,
    { allowNull: true, min: 0 },
  );
  if (estimatedCostPerHour !== undefined) data.estimatedCostPerHour = estimatedCostPerHour;

  const peakHoursMultiplier = parseOptionalNumber(
    payload.peakHoursMultiplier,
    'peakHoursMultiplier',
    issues,
    { min: 1 },
  );
  if (peakHoursMultiplier !== undefined) data.peakHoursMultiplier = peakHoursMultiplier;

  const peakHoursStart = parseHour(payload.peakHoursStart, 'peakHoursStart', issues);
  if (peakHoursStart !== undefined) data.peakHoursStart = peakHoursStart;

  const peakHoursEnd = parseHour(payload.peakHoursEnd, 'peakHoursEnd', issues);
  if (peakHoursEnd !== undefined) data.peakHoursEnd = peakHoursEnd;

  const operatingDaysPerWeek = parseBoundedInt(
    payload.operatingDaysPerWeek,
    'operatingDaysPerWeek',
    issues,
    { min: 1, max: 7 },
  );
  if (operatingDaysPerWeek !== undefined) data.operatingDaysPerWeek = operatingDaysPerWeek;

  const operatingHoursPerDay = parseBoundedInt(
    payload.operatingHoursPerDay,
    'operatingHoursPerDay',
    issues,
    { min: 1, max: 24 },
  );
  if (operatingHoursPerDay !== undefined) data.operatingHoursPerDay = operatingHoursPerDay;

  const slaUptimePercent = parseOptionalNumber(payload.slaUptimePercent, 'slaUptimePercent', issues, {
    allowNull: true,
    min: 0,
  });
  if (slaUptimePercent !== undefined) {
    if (slaUptimePercent !== null && slaUptimePercent > 100) {
      issues.push({ field: 'slaUptimePercent', message: 'doit Ãªtre infÃ©rieur ou Ã©gal Ã  100' });
    } else {
      data.slaUptimePercent = slaUptimePercent;
    }
  }

  const slaPenaltyPerHour = parseOptionalNumber(payload.slaPenaltyPerHour, 'slaPenaltyPerHour', issues, {
    allowNull: true,
    min: 0,
  });
  if (slaPenaltyPerHour !== undefined) data.slaPenaltyPerHour = slaPenaltyPerHour;

  const slaPenaltyFlat = parseOptionalNumber(payload.slaPenaltyFlat, 'slaPenaltyFlat', issues, {
    allowNull: true,
    min: 0,
  });
  if (slaPenaltyFlat !== undefined) data.slaPenaltyFlat = slaPenaltyFlat;

  const contractualRTO = parseBoundedInt(payload.contractualRTO, 'contractualRTO', issues, {
    min: 0,
    max: 100000,
    allowNull: true,
  });
  if (contractualRTO !== undefined) data.contractualRTO = contractualRTO;

  const estimatedCustomerChurnPerHour = parseOptionalNumber(
    payload.estimatedCustomerChurnPerHour,
    'estimatedCustomerChurnPerHour',
    issues,
    { allowNull: true, min: 0 },
  );
  if (estimatedCustomerChurnPerHour !== undefined) {
    data.estimatedCustomerChurnPerHour = estimatedCustomerChurnPerHour;
  }

  const customerLifetimeValue = parseOptionalNumber(
    payload.customerLifetimeValue,
    'customerLifetimeValue',
    issues,
    { allowNull: true, min: 0 },
  );
  if (customerLifetimeValue !== undefined) data.customerLifetimeValue = customerLifetimeValue;

  const reputationImpactCategory = parseOptionalString(
    payload.reputationImpactCategory,
    'reputationImpactCategory',
    issues,
    { allowNull: true, maxLength: 32 },
  );
  if (reputationImpactCategory !== undefined) {
    if (
      reputationImpactCategory !== null &&
      !['none', 'low', 'medium', 'high', 'critical'].includes(reputationImpactCategory.toLowerCase())
    ) {
      issues.push({
        field: 'reputationImpactCategory',
        message: 'doit Ãªtre none|low|medium|high|critical',
      });
    } else {
      data.reputationImpactCategory =
        reputationImpactCategory == null ? null : reputationImpactCategory.toLowerCase();
    }
  }

  const source = parseOptionalString(payload.source, 'source', issues, { maxLength: 32 });
  if (source !== undefined) {
    if (source === null) {
      issues.push({ field: 'source', message: 'source must not be null' });
    } else if (!['manual', 'ai_suggested', 'cloud_tags', 'imported'].includes(source.toLowerCase())) {
      issues.push({ field: 'source', message: 'doit Ãªtre manual|ai_suggested|cloud_tags|imported' });
    } else {
      data.source = source.toLowerCase();
    }
  }

  const aiConfidence = parseOptionalNumber(payload.aiConfidence, 'aiConfidence', issues, {
    allowNull: true,
    min: 0,
  });
  if (aiConfidence !== undefined) {
    if (aiConfidence !== null && aiConfidence > 1) {
      issues.push({ field: 'aiConfidence', message: 'doit Ãªtre infÃ©rieur ou Ã©gal Ã  1' });
    } else {
      data.aiConfidence = aiConfidence;
    }
  }

  const validatedByUser = parseOptionalBoolean(payload.validatedByUser, 'validatedByUser', issues);
  if (validatedByUser !== undefined) data.validatedByUser = validatedByUser;

  const mutualExclusionGroup = parseOptionalString(
    payload.mutualExclusionGroup,
    'mutualExclusionGroup',
    issues,
    { allowNull: true, maxLength: 128 },
  );
  if (mutualExclusionGroup !== undefined) data.mutualExclusionGroup = mutualExclusionGroup;

  if (!isPatch) {
    const direct = typeof data.estimatedCostPerHour === 'number' && data.estimatedCostPerHour > 0;
    const annual = typeof data.annualRevenue === 'number' && data.annualRevenue > 0;
    const tx =
      typeof data.transactionsPerHour === 'number' &&
      data.transactionsPerHour > 0 &&
      typeof data.revenuePerTransaction === 'number' &&
      data.revenuePerTransaction > 0;
    const sourceValue = String(data.source || 'manual');
    const canBeSuggestion = sourceValue === 'ai_suggested' || sourceValue === 'cloud_tags';
    if (!direct && !annual && !tx && !canBeSuggestion) {
      issues.push({
        field: 'businessValue',
        message:
          'au moins une mÃ©thode de valorisation est requise (estimatedCostPerHour, annualRevenue, ou transactionsPerHour x revenuePerTransaction)',
      });
    }
  }

  return { issues, data };
}

async function serializeFlow(
  flow: Awaited<ReturnType<typeof prisma.businessFlow.findFirstOrThrow>>,
  currency: SupportedCurrency,
  tenantId: string,
) {
  let snapshot = null;
  try {
    snapshot = await businessFlowFinancialEngine.calculateFlowFinancialSnapshot({
      tenantId,
      flowId: flow.id,
      preferredCurrency: currency,
      sourceCurrency: 'EUR',
    });
  } catch (error) {
    appLogger.warn('business_flow.serialize.snapshot_failed', {
      tenantId,
      flowId: flow.id,
      reason: error instanceof Error ? error.message : 'unknown_error',
    });
  }
  const persistedComputed =
    flow.calculatedCostPerHour != null && flow.calculatedCostPerHour > 0
      ? {
          directCostPerHour: flow.calculatedCostPerHour,
          slaPenaltyPerHour: 0,
          indirectCostPerHour: 0,
          totalCostPerHour: flow.calculatedCostPerHour,
          peakCostPerHour:
            flow.calculatedCostPerHour * Math.max(1, Number(flow.peakHoursMultiplier || 1.5)),
          method: flow.costCalculationMethod || 'services_aggregate',
          confidence: flow.validatedByUser ? ('medium' as const) : ('low' as const),
          currency,
        }
      : null;
  const computed =
    snapshot?.computedCost ??
    BusinessFlowFinancialEngineService.calculateFlowCostPerHour(flow, currency) ??
    persistedComputed;
  const financialImpact = snapshot
    ? {
        hourlyDowntimeCost: snapshot.hourlyDowntimeCost,
        aleAnnual: snapshot.aleAnnual,
        averageRtoHours: snapshot.averageRtoHours,
        incidentProbabilityAnnual: snapshot.incidentProbabilityAnnual,
        servicesCount: snapshot.servicesCount,
        sourceBreakdown: snapshot.sourceBreakdown,
        estimable: snapshot.estimable,
      }
    : null;
  return {
    ...flow,
    computedCost: computed,
    currency,
    precisionBadge: flow.validatedByUser ? 'business_flow_validated' : 'business_flow_not_validated',
    financialImpact,
    financialImpactMessage: snapshot?.message ?? null,
  };
}

async function resolveTenantCurrency(tenantId: string): Promise<SupportedCurrency> {
  await CurrencyService.getRates('USD');
  const profile = await prisma.organizationProfile.findUnique({
    where: { tenantId },
    select: { customCurrency: true },
  });
  const normalized = String(profile?.customCurrency ?? 'EUR').toUpperCase();
  if ((SUPPORTED_CURRENCIES as readonly string[]).includes(normalized)) {
    return normalized as SupportedCurrency;
  }
  return 'EUR';
}

router.post('/ai/suggest', requireRole('OPERATOR'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    if (!checkAISuggestionRateLimit(tenantId)) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Maximum 5 AI flow suggestions per hour per organization.',
      });
    }

    const [suggestions, currency, nodes, edges] = await Promise.all([
      aiFlowSuggesterService.suggestBusinessFlows(tenantId),
      resolveTenantCurrency(tenantId),
      prisma.infraNode.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          type: true,
          isSPOF: true,
          criticalityScore: true,
          redundancyScore: true,
        },
      }),
      prisma.infraEdge.findMany({
        where: { tenantId },
        select: { sourceId: true, targetId: true },
      }),
    ]);
    const flows = await Promise.all(
      suggestions.map(async (suggestion) => {
        const flow = await prisma.businessFlow.findFirst({
          where: { id: suggestion.flowId, tenantId },
          include: { flowNodes: { orderBy: { orderIndex: 'asc' } } },
        });
        return flow ? serializeFlow(flow, currency, tenantId) : null;
      }),
    );
    const suggestionInsights = buildAISuggestionInsights({
      suggestions,
      nodes,
      edges,
    });

    return res.json({
      suggestionsCreated: suggestions.length,
      suggestions: flows.filter((flow): flow is NonNullable<typeof flow> => Boolean(flow)),
      suggestionInsights,
    });
  } catch (error) {
    appLogger.error('Error suggesting business flows from AI', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cloud/enrich', requireRole('OPERATOR'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    const result = await cloudEnrichmentService.enrichFromCloudData(tenantId);
    return res.json(result);
  } catch (error) {
    appLogger.error('Error enriching business flows from cloud metadata', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireRole('OPERATOR'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    const currency = await resolveTenantCurrency(tenantId);

    const payload = (req.body || {}) as Record<string, unknown>;
    const { issues, data } = parseFlowInput(payload, false);
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const flow = await prisma.businessFlow.create({
      data: {
        tenantId,
        name: String(data.name),
        ...(Object.prototype.hasOwnProperty.call(data, 'description') ? { description: data.description as string | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'category') ? { category: data.category as string | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'annualRevenue') ? { annualRevenue: data.annualRevenue as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'transactionsPerHour') ? { transactionsPerHour: data.transactionsPerHour as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'revenuePerTransaction') ? { revenuePerTransaction: data.revenuePerTransaction as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'estimatedCostPerHour') ? { estimatedCostPerHour: data.estimatedCostPerHour as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'peakHoursMultiplier') ? { peakHoursMultiplier: data.peakHoursMultiplier as number } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'peakHoursStart') ? { peakHoursStart: data.peakHoursStart as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'peakHoursEnd') ? { peakHoursEnd: data.peakHoursEnd as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'operatingDaysPerWeek') ? { operatingDaysPerWeek: data.operatingDaysPerWeek as number } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'operatingHoursPerDay') ? { operatingHoursPerDay: data.operatingHoursPerDay as number } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'slaUptimePercent') ? { slaUptimePercent: data.slaUptimePercent as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'slaPenaltyPerHour') ? { slaPenaltyPerHour: data.slaPenaltyPerHour as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'slaPenaltyFlat') ? { slaPenaltyFlat: data.slaPenaltyFlat as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'contractualRTO') ? { contractualRTO: data.contractualRTO as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'estimatedCustomerChurnPerHour')
          ? { estimatedCustomerChurnPerHour: data.estimatedCustomerChurnPerHour as number | null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'customerLifetimeValue') ? { customerLifetimeValue: data.customerLifetimeValue as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'reputationImpactCategory')
          ? { reputationImpactCategory: data.reputationImpactCategory as string | null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'source') ? { source: data.source as string } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'aiConfidence') ? { aiConfidence: data.aiConfidence as number | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'validatedByUser')
          ? {
              validatedByUser: Boolean(data.validatedByUser),
              validatedAt: data.validatedByUser ? new Date() : null,
            }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'mutualExclusionGroup')
          ? { mutualExclusionGroup: data.mutualExclusionGroup as string | null }
          : {}),
      },
      include: {
        flowNodes: {
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    const updated = await businessFlowFinancialEngine.recalculateFlowComputedCost(tenantId, flow.id);
    if (!updated) return res.status(500).json({ error: 'Failed to compute flow cost' });

    const persisted = await prisma.businessFlow.findFirstOrThrow({
      where: { id: flow.id, tenantId },
      include: { flowNodes: { orderBy: { orderIndex: 'asc' } } },
    });

    return res.status(201).json(await serializeFlow(persisted, currency, tenantId));
  } catch (error) {
    appLogger.error('Error creating business flow', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', requireRole('READER'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    const currency = await resolveTenantCurrency(tenantId);

    const flows = await prisma.businessFlow.findMany({
      where: { tenantId },
      include: {
        flowNodes: {
          orderBy: { orderIndex: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const result = await Promise.all(flows.map((flow) => serializeFlow(flow, currency, tenantId)));
    return res.json(result);
  } catch (error) {
    appLogger.error('Error listing business flows', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', requireRole('READER'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    const currency = await resolveTenantCurrency(tenantId);
    const flowId = req.params.id;
    if (!flowId) return res.status(400).json({ error: 'id is required' });

    const flow = await prisma.businessFlow.findFirst({
      where: { id: flowId, tenantId },
      include: {
        flowNodes: {
          orderBy: { orderIndex: 'asc' },
          include: {
            infraNode: {
              select: {
                id: true,
                name: true,
                type: true,
                provider: true,
                region: true,
                isSPOF: true,
                criticalityScore: true,
              },
            },
          },
        },
      },
    });

    if (!flow) return res.status(404).json({ error: 'Business flow not found' });
    return res.json(await serializeFlow(flow, currency, tenantId));
  } catch (error) {
    appLogger.error('Error fetching business flow', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id', requireRole('OPERATOR'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    const currency = await resolveTenantCurrency(tenantId);
    const flowId = req.params.id;
    if (!flowId) return res.status(400).json({ error: 'id is required' });

    const existing = await prisma.businessFlow.findFirst({
      where: { id: flowId, tenantId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'Business flow not found' });

    const payload = (req.body || {}) as Record<string, unknown>;
    const { issues, data } = parseFlowInput(payload, true);
    if (issues.length > 0) return res.status(400).json(buildValidationError(issues));

    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'validatedByUser') {
        updateData.validatedByUser = Boolean(value);
        updateData.validatedAt = value ? new Date() : null;
      } else {
        updateData[key] = value;
      }
    }

    const flow = await prisma.businessFlow.update({
      where: { id: flowId },
      data: updateData,
      include: {
        flowNodes: {
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    await businessFlowFinancialEngine.recalculateFlowComputedCost(tenantId, flow.id);
    const refreshed = await prisma.businessFlow.findFirstOrThrow({
      where: { id: flow.id, tenantId },
      include: { flowNodes: { orderBy: { orderIndex: 'asc' } } },
    });

    return res.json(await serializeFlow(refreshed, currency, tenantId));
  } catch (error) {
    appLogger.error('Error updating business flow', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', requireRole('OPERATOR'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    const flowId = req.params.id;
    if (!flowId) return res.status(400).json({ error: 'id is required' });

    const deleted = await prisma.businessFlow.deleteMany({
      where: { id: flowId, tenantId },
    });
    if (deleted.count === 0) return res.status(404).json({ error: 'Business flow not found' });
    return res.status(204).send();
  } catch (error) {
    appLogger.error('Error deleting business flow', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/validate', requireRole('OPERATOR'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    const currency = await resolveTenantCurrency(tenantId);
    const flowId = req.params.id;
    if (!flowId) return res.status(400).json({ error: 'id is required' });

    const flow = await prisma.businessFlow.updateMany({
      where: { id: flowId, tenantId },
      data: {
        validatedByUser: true,
        validatedAt: new Date(),
      },
    });

    if (flow.count === 0) return res.status(404).json({ error: 'Business flow not found' });
    await businessFlowFinancialEngine.recalculateFlowComputedCost(tenantId, flowId);

    const updated = await prisma.businessFlow.findFirst({
      where: { id: flowId, tenantId },
      include: { flowNodes: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!updated) return res.status(404).json({ error: 'Business flow not found' });

    return res.json(await serializeFlow(updated, currency, tenantId));
  } catch (error) {
    appLogger.error('Error validating business flow', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/nodes', requireRole('OPERATOR'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    const currency = await resolveTenantCurrency(tenantId);
    const flowId = req.params.id;
    if (!flowId) return res.status(400).json({ error: 'id is required' });

    const flow = await prisma.businessFlow.findFirst({
      where: { id: flowId, tenantId },
      select: { id: true },
    });
    if (!flow) return res.status(404).json({ error: 'Business flow not found' });

    const payload = (req.body || {}) as Record<string, unknown>;
    const rawNodes = Array.isArray(payload.nodes) ? payload.nodes : payload.infraNodeId ? [payload] : [];
    if (rawNodes.length === 0) {
      return res.status(400).json({
        error: 'Payload invalide',
        details: [{ field: 'nodes', message: 'nodes est requis et doit Ãªtre un tableau non vide' }],
      });
    }

    const issues: ValidationIssue[] = [];
    const parsedNodes: Array<{
      infraNodeId: string;
      orderIndex: number;
      role: string | null;
      isCritical: boolean;
      hasAlternativePath: boolean;
      alternativeNodeId: string | null;
    }> = [];

    rawNodes.forEach((entry, index) => {
      const node = entry as Record<string, unknown>;
      const infraNodeId = parseRequiredString(node.infraNodeId, `nodes[${index}].infraNodeId`, issues, {
        minLength: 2,
        maxLength: 200,
      });
      const order = parseOptionalNumber(node.orderIndex, `nodes[${index}].orderIndex`, issues, { min: 0 });
      const role = parseOptionalString(node.role, `nodes[${index}].role`, issues, {
        allowNull: true,
        maxLength: 64,
      });
      const isCritical = parseOptionalBoolean(node.isCritical, `nodes[${index}].isCritical`, issues);
      const hasAlternativePath = parseOptionalBoolean(
        node.hasAlternativePath,
        `nodes[${index}].hasAlternativePath`,
        issues,
      );
      const alternativeNodeId = parseOptionalString(
        node.alternativeNodeId,
        `nodes[${index}].alternativeNodeId`,
        issues,
        { allowNull: true, maxLength: 200 },
      );

      if (infraNodeId === undefined) return;
      if (order !== undefined && !Number.isInteger(order)) {
        issues.push({ field: `nodes[${index}].orderIndex`, message: 'doit Ãªtre un entier >= 0' });
        return;
      }

      parsedNodes.push({
        infraNodeId,
        orderIndex: Number.isInteger(order) ? Number(order) : index,
        role: role ?? null,
        isCritical: isCritical ?? true,
        hasAlternativePath: hasAlternativePath ?? false,
        alternativeNodeId: alternativeNodeId ?? null,
      });
    });

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const nodeIds = Array.from(new Set(parsedNodes.map((node) => node.infraNodeId)));
    const existingNodes = await prisma.infraNode.findMany({
      where: { tenantId, id: { in: nodeIds } },
      select: { id: true },
    });
    if (existingNodes.length !== nodeIds.length) {
      return res.status(400).json({
        error: 'Payload invalide',
        details: [{ field: 'nodes', message: 'un ou plusieurs infraNodeId sont invalides pour ce tenant' }],
      });
    }

    await prisma.$transaction(
      parsedNodes.map((node) =>
        prisma.businessFlowNode.upsert({
          where: {
            businessFlowId_infraNodeId: {
              businessFlowId: flowId,
              infraNodeId: node.infraNodeId,
            },
          },
          create: {
            businessFlowId: flowId,
            infraNodeId: node.infraNodeId,
            tenantId,
            orderIndex: node.orderIndex,
            role: node.role,
            isCritical: node.isCritical,
            hasAlternativePath: node.hasAlternativePath,
            alternativeNodeId: node.alternativeNodeId,
          },
          update: {
            orderIndex: node.orderIndex,
            role: node.role,
            isCritical: node.isCritical,
            hasAlternativePath: node.hasAlternativePath,
            alternativeNodeId: node.alternativeNodeId,
          },
        }),
      ),
    );

    await businessFlowFinancialEngine.recalculateFlowComputedCost(tenantId, flowId);

    const updatedFlow = await prisma.businessFlow.findFirst({
      where: { id: flowId, tenantId },
      include: {
        flowNodes: {
          orderBy: { orderIndex: 'asc' },
          include: {
            infraNode: {
              select: { id: true, name: true, type: true, provider: true, region: true },
            },
          },
        },
      },
    });
    if (!updatedFlow) return res.status(404).json({ error: 'Business flow not found' });

    return res.status(201).json(await serializeFlow(updatedFlow, currency, tenantId));
  } catch (error) {
    appLogger.error('Error adding nodes to business flow', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id/nodes/:nodeId', requireRole('OPERATOR'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });
    const currency = await resolveTenantCurrency(tenantId);
    const flowId = req.params.id;
    const nodeId = req.params.nodeId;
    if (!flowId || !nodeId) return res.status(400).json({ error: 'id and nodeId are required' });

    const flow = await prisma.businessFlow.findFirst({
      where: { id: flowId, tenantId },
      select: { id: true },
    });
    if (!flow) return res.status(404).json({ error: 'Business flow not found' });

    const deleted = await prisma.businessFlowNode.deleteMany({
      where: { businessFlowId: flowId, infraNodeId: nodeId, tenantId },
    });
    if (deleted.count === 0) return res.status(404).json({ error: 'Node is not linked to this flow' });

    await businessFlowFinancialEngine.recalculateFlowComputedCost(tenantId, flowId);

    const updated = await prisma.businessFlow.findFirst({
      where: { id: flowId, tenantId },
      include: { flowNodes: { orderBy: { orderIndex: 'asc' } } },
    });
    if (!updated) return res.status(404).json({ error: 'Business flow not found' });

    return res.json(await serializeFlow(updated, currency, tenantId));
  } catch (error) {
    appLogger.error('Error removing node from business flow', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

