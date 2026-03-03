import { appLogger } from "../utils/logger.js";
// ============================================================
// Simulation Routes — What-if scenario simulations
// ============================================================

import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { requireFeature } from '../middleware/licenseMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { runSimulation, getScenarioOptions } from '../graph/simulationEngine.js';
import { SCENARIO_LIBRARY } from '../simulations/data/scenario-library.js';
import { computeRecoveryPriorities } from '../simulations/recovery-priority.js';
import {
  type FinancialNodeInput,
  type NodeFinancialOverrideInput,
} from '../services/financial-engine.service.js';
import {
  estimateServiceMonthlyProductionCost,
  resolveCompanyFinancialProfile,
  selectDrStrategyForService,
} from '../services/company-financial-profile.service.js';
import { CurrencyService } from '../services/currency.service.js';
import type { DrStrategyKey } from '../constants/dr-financial-reference-data.js';
import type { SimulationResult, WarRoomFinancial } from '../graph/types.js';

const router = Router();

type InfraNodeWithEdges = Prisma.InfraNodeGetPayload<{
  include: {
    inEdges: true;
    outEdges: true;
  };
}>;

type SimulationBiaProcessSource = {
  validatedRTO: number | null;
  suggestedRTO: number | null;
  validatedRPO: number | null;
  suggestedRPO: number | null;
  impactCategory: string | null;
  criticalityScore: number | null;
  financialImpact: Prisma.JsonValue | null;
};

type WarRoomNodeCost = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  costPerHour: number;
  totalCost: number;
  recoveryCost: number;
  rtoMinutes: number;
  impactedAtSeconds: number;
  downtimeSeconds: number;
  downtimeMinutes: number;
  costSource: 'bia_configured' | 'infra_estimated' | 'fallback';
  costSourceLabel: string;
  recoveryStrategy: DrStrategyKey;
  monthlyDrCost: number;
  recoveryActivationFactor: number;
};

function roundAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundAmountPrecise(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function toFinancialNodeInput(node: InfraNodeWithEdges): FinancialNodeInput {
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

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function extractBiaHourlyCost(financialImpact: unknown): number | null {
  if (!financialImpact || typeof financialImpact !== 'object' || Array.isArray(financialImpact)) {
    return null;
  }
  const payload = financialImpact as Record<string, unknown>;
  const candidates = [
    payload.estimatedCostPerHour,
    payload.hourlyDowntimeCost,
    payload.totalCostPerHour,
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function toUpperNodeType(value: unknown): string {
  return String(value || '').toUpperCase();
}

function resolveInfraImpactMultiplier(node: {
  type: string;
  name?: string | null;
}): number {
  const nodeType = toUpperNodeType(node.type);
  const nodeName = String(node.name || '').toLowerCase();

  if (nodeType === 'DATABASE') return 5;
  if (nodeType === 'API_GATEWAY' || nodeType === 'LOAD_BALANCER' || nodeType === 'APPLICATION' || nodeType === 'MICROSERVICE') {
    return 3;
  }
  if (nodeType === 'MESSAGE_QUEUE') return 2;
  if (nodeType === 'OBJECT_STORAGE' || nodeType === 'FILE_STORAGE' || nodeType === 'CDN' || nodeType === 'DNS') {
    return 1.5;
  }
  if (
    nodeName.includes('monitor') ||
    nodeName.includes('logging') ||
    nodeName.includes('observability') ||
    nodeName.includes('siem') ||
    nodeName.includes('datadog')
  ) {
    return 0.5;
  }
  return 1;
}

function resolveFallbackHourlyRate(criticality: 'critical' | 'high' | 'medium' | 'low'): number {
  if (criticality === 'critical') return 500;
  if (criticality === 'high') return 200;
  if (criticality === 'medium') return 50;
  return 10;
}

function normalizeCriticality(
  recoveryTier: number | null | undefined,
  criticalityScore: number | null | undefined,
  impactCategory: string | null | undefined,
): 'critical' | 'high' | 'medium' | 'low' {
  const impact = String(impactCategory || '').toLowerCase();
  if (impact.includes('tier1') || impact.includes('critical') || impact.includes('mission') || recoveryTier === 1) {
    return 'critical';
  }
  if (impact.includes('tier2') || impact.includes('high') || impact.includes('business') || recoveryTier === 2) {
    return 'high';
  }
  if (impact.includes('tier3') || impact.includes('medium') || impact.includes('important') || recoveryTier === 3) {
    return 'medium';
  }
  if (impact.includes('tier4') || recoveryTier === 4) {
    return 'low';
  }

  const score = Number(criticalityScore);
  if (Number.isFinite(score)) {
    const normalized = score > 1 ? score / 100 : score;
    if (normalized >= 0.85) return 'critical';
    if (normalized >= 0.65) return 'high';
    if (normalized >= 0.45) return 'medium';
  }
  return 'low';
}

function resolveRecoveryActivationFactor(strategy: DrStrategyKey): number {
  switch (strategy) {
    case 'active_active':
      return 0;
    case 'hot_standby':
      return 0.2;
    case 'warm_standby':
      return 0.4;
    case 'pilot_light':
      return 0.8;
    case 'backup_restore':
    default:
      return 1.2;
  }
}

function resolveStrategyOverride(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const payload = metadata as Record<string, unknown>;
  if (typeof payload.recoveryStrategy === 'string' && payload.recoveryStrategy.trim().length > 0) {
    return payload.recoveryStrategy.trim();
  }
  const recommendation = payload.landingZoneRecommendation;
  if (
    recommendation &&
    typeof recommendation === 'object' &&
    !Array.isArray(recommendation) &&
    typeof (recommendation as Record<string, unknown>).strategyOverride === 'string'
  ) {
    return String((recommendation as Record<string, unknown>).strategyOverride);
  }
  return null;
}

function resolveImpactedAtByNodeId(
  result: SimulationResult,
  fallbackDowntimeSeconds: number,
): Map<string, number> {
  const byNodeId = new Map<string, number>();
  for (const event of result.warRoomData?.propagationTimeline || []) {
    const delaySeconds = Math.max(
      0,
      Math.round(
        Number(
          event.delaySeconds ??
            (Number(event.timestampMinutes || 0) * 60),
        ),
      ),
    );
    const previous = byNodeId.get(event.nodeId);
    if (previous == null || delaySeconds < previous) {
      byNodeId.set(event.nodeId, delaySeconds);
    }
  }
  for (const node of result.directlyAffected || []) {
    byNodeId.set(node.id, 0);
  }
  for (const node of result.cascadeImpacted || []) {
    const previous = byNodeId.get(node.id);
    const next = clamp(
      Math.round((Math.max(0, Number(node.cascadeDepth || 0)) / Math.max(1, result.blastRadiusMetrics?.propagationDepth || 1)) * fallbackDowntimeSeconds),
      0,
      fallbackDowntimeSeconds,
    );
    if (previous == null || next < previous) {
      byNodeId.set(node.id, next);
    }
  }
  for (const node of result.warRoomData?.impactedNodes || []) {
    const previous = byNodeId.get(node.id);
    const next = Math.max(
      0,
      Math.round(
        Number(
          node.impactedAtSeconds ??
            (Number(node.impactedAt || 0) * 60),
        ),
      ),
    );
    if (previous == null || next < previous) {
      byNodeId.set(node.id, next);
    }
  }
  return byNodeId;
}

function resolveRtoMinutes(
  node: InfraNodeWithEdges,
  processByNodeId: Map<string, SimulationBiaProcessSource>,
  fallbackMinutes: number,
): number {
  const process = processByNodeId.get(node.id);
  const rto =
    process?.validatedRTO ??
    process?.suggestedRTO ??
    node.validatedRTO ??
    node.suggestedRTO ??
    fallbackMinutes;
  return Math.max(1, roundAmount(normalizePositiveNumber(rto, fallbackMinutes)));
}

function computeCumulativeLossTimeline(
  nodeCosts: WarRoomNodeCost[],
  totalDowntimeSeconds: number,
  timeline: SimulationResult['warRoomData']['propagationTimeline'],
): WarRoomFinancial['cumulativeLossTimeline'] {
  const points = new Set<number>([0, totalDowntimeSeconds]);
  for (const event of timeline || []) {
    points.add(
      clamp(
        Math.round(
          Number(
            event.delaySeconds ??
              (Number(event.timestampMinutes || 0) * 60),
          ),
        ),
        0,
        totalDowntimeSeconds,
      ),
    );
  }

  const ordered = Array.from(points).sort((a, b) => a - b);
  const rows: WarRoomFinancial['cumulativeLossTimeline'] = [];
  let cumulative = 0;
  let previousSecond = 0;

  for (const second of ordered) {
    const activeHourlyCost = nodeCosts.reduce((sum, node) => (
      node.impactedAtSeconds <= second ? sum + node.costPerHour : sum
    ), 0);
    const deltaSeconds = Math.max(0, second - previousSecond);
    cumulative += activeHourlyCost * (deltaSeconds / 3600);
    rows.push({
      timestampMinutes: roundAmountPrecise(second / 60),
      timestampSeconds: roundAmount(second),
      cumulativeBusinessLoss: roundAmountPrecise(cumulative),
      activeHourlyCost: roundAmount(activeHourlyCost),
    });
    previousSecond = second;
  }

  return rows;
}

function buildFallbackWarRoomFinancial(result: SimulationResult): WarRoomFinancial {
  const estimatedDowntime = Math.max(1, normalizePositiveNumber(result.metrics.estimatedDowntimeMinutes, 60));
  const totalDurationSeconds = roundAmount(estimatedDowntime * 60);
  const hourlyCost = roundAmount(
    normalizePositiveNumber(result.metrics.estimatedFinancialLoss, 0) /
      Math.max(estimatedDowntime / 60, 1),
  );
  const projectedBusinessLoss = roundAmount(result.metrics.estimatedFinancialLoss || 0);
  return {
    hourlyDowntimeCost: hourlyCost,
    recoveryCostEstimate: roundAmount(projectedBusinessLoss * 0.25),
    projectedBusinessLoss,
    totalDurationSeconds,
    totalDurationMinutes: estimatedDowntime,
    costConfidence: 'gross',
    costConfidenceLabel: 'Estimation grossiere - configurez le profil financier',
    biaCoverageRatio: 0,
    trackedNodeCount: 0,
    cumulativeLossTimeline: [
      { timestampMinutes: 0, timestampSeconds: 0, cumulativeBusinessLoss: 0, activeHourlyCost: hourlyCost },
      {
        timestampMinutes: roundAmountPrecise(estimatedDowntime),
        timestampSeconds: totalDurationSeconds,
        cumulativeBusinessLoss: projectedBusinessLoss,
        activeHourlyCost: hourlyCost,
      },
    ],
    nodeCostBreakdown: [],
  };
}

async function buildWarRoomFinancial(
  tenantId: string,
  result: SimulationResult,
): Promise<WarRoomFinancial> {
  const impactedIds = Array.from(
    new Set([
      ...(result.directlyAffected || []).map((node) => node.id),
      ...(result.cascadeImpacted || []).map((node) => node.id),
      ...(result.warRoomData?.impactedNodes || []).map((node) => node.id),
    ].filter((id) => typeof id === 'string' && id.length > 0)),
  );

  if (impactedIds.length === 0) {
    return buildFallbackWarRoomFinancial(result);
  }

  const [nodes, latestBia, resolvedProfile, overrides] = await Promise.all([
    prisma.infraNode.findMany({
      where: {
        tenantId,
        id: { in: impactedIds },
      },
      include: {
        inEdges: true,
        outEdges: true,
      },
    }),
    prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        processes: {
          select: {
            serviceNodeId: true,
            validatedRTO: true,
            suggestedRTO: true,
            validatedRPO: true,
            suggestedRPO: true,
            criticalityScore: true,
            impactCategory: true,
            financialImpact: true,
            validationStatus: true,
          },
        },
      },
    }),
    resolveCompanyFinancialProfile(prisma, tenantId),
    prisma.nodeFinancialOverride.findMany({
      where: {
        tenantId,
        nodeId: { in: impactedIds },
      },
      select: {
        nodeId: true,
        customCostPerHour: true,
      },
    }),
  ]);

  if (nodes.length === 0) {
    return buildFallbackWarRoomFinancial(result);
  }

  const processByNodeId = new Map<string, SimulationBiaProcessSource>();
  for (const process of latestBia?.processes || []) {
    if (process.validationStatus !== 'validated') continue;
    processByNodeId.set(process.serviceNodeId, {
      validatedRTO: process.validatedRTO,
      suggestedRTO: process.suggestedRTO,
      validatedRPO: process.validatedRPO,
      suggestedRPO: process.suggestedRPO,
      impactCategory: process.impactCategory,
      criticalityScore: process.criticalityScore,
      financialImpact: process.financialImpact,
    });
  }

  const overrideByNodeId = new Map<string, NodeFinancialOverrideInput>();
  for (const override of overrides) {
    if (!(override.customCostPerHour > 0)) continue;
    overrideByNodeId.set(override.nodeId, {
      customCostPerHour: override.customCostPerHour,
    });
  }

  const fallbackRtoMinutes = Math.max(
    1,
    roundAmount(normalizePositiveNumber(result.metrics.estimatedDowntimeMinutes, 60)),
  );
  const fallbackRtoSeconds = Math.max(1, roundAmount(fallbackRtoMinutes * 60));
  const impactedAtByNodeId = resolveImpactedAtByNodeId(result, fallbackRtoSeconds);
  const timelineMaxDelaySeconds = Math.max(
    0,
    ...((result.warRoomData?.propagationTimeline || []).map((event) =>
      Math.round(
        Number(event.delaySeconds ?? (Number(event.timestampMinutes || 0) * 60)),
      ),
    )),
  );
  const totalDowntimeSeconds = Math.max(
    fallbackRtoSeconds,
    timelineMaxDelaySeconds,
    ...Array.from(impactedAtByNodeId.values()),
  );

  const nodeCosts = nodes.map((node) => {
    const financialNode = toFinancialNodeInput(node);
    const override = overrideByNodeId.get(node.id);
    const validatedProcess = processByNodeId.get(node.id);

    const biaCostPerHour = extractBiaHourlyCost(validatedProcess?.financialImpact);
    const biaCostInCurrency =
      biaCostPerHour && biaCostPerHour > 0
        ? roundAmount(
            CurrencyService.convertAmount(biaCostPerHour, 'EUR', resolvedProfile.currency),
          )
        : 0;

    const criticality = normalizeCriticality(
      null,
      validatedProcess?.criticalityScore ?? node.criticalityScore,
      validatedProcess?.impactCategory ?? node.impactCategory,
    );
    const monthlyProductionCost = estimateServiceMonthlyProductionCost(
      {
        type: node.type,
        provider: node.provider,
        metadata: node.metadata,
        criticalityScore: validatedProcess?.criticalityScore ?? node.criticalityScore,
        impactCategory: validatedProcess?.impactCategory ?? node.impactCategory,
      },
      resolvedProfile.currency,
    ).estimatedMonthlyCost;
    const estimatedInfraHourly = roundAmount(
      (Math.max(0, monthlyProductionCost) / 730) *
        resolveInfraImpactMultiplier({ type: node.type, name: node.name }),
    );
    const fallbackHourly = resolveFallbackHourlyRate(criticality);

    let costPerHour = fallbackHourly;
    let costSource: WarRoomNodeCost['costSource'] = 'fallback';
    let costSourceLabel = 'Fallback Tier';

    if (biaCostInCurrency > 0) {
      costPerHour = biaCostInCurrency;
      costSource = 'bia_configured';
      costSourceLabel = 'BIA configure';
    } else if (estimatedInfraHourly > 0) {
      costPerHour = estimatedInfraHourly;
      costSource = 'infra_estimated';
      costSourceLabel = 'Estimation infra';
    }

    if (override?.customCostPerHour && override.customCostPerHour > 0) {
      costPerHour = roundAmount(override.customCostPerHour);
      costSource = 'bia_configured';
      costSourceLabel = 'Override financier';
    }

    const rtoMinutes = resolveRtoMinutes(node, processByNodeId, fallbackRtoMinutes);
    const strategySelection = selectDrStrategyForService({
      targetRtoMinutes: validatedProcess?.validatedRTO ?? rtoMinutes,
      targetRpoMinutes:
        validatedProcess?.validatedRPO ??
        validatedProcess?.suggestedRPO ??
        node.validatedRPO ??
        node.suggestedRPO ??
        null,
      criticality,
      monthlyProductionCost,
      overrideStrategy: resolveStrategyOverride(node.metadata),
      nodeType: node.type,
      provider: node.provider,
      metadata: node.metadata,
    });
    const recoveryActivationFactor = resolveRecoveryActivationFactor(strategySelection.strategy);
    const recoveryCost = roundAmount(strategySelection.monthlyDrCost * recoveryActivationFactor);
    const impactedAtSeconds = clamp(
      Number(impactedAtByNodeId.get(node.id) ?? 0),
      0,
      totalDowntimeSeconds,
    );
    const downtimeSeconds = Math.max(0, totalDowntimeSeconds - impactedAtSeconds);
    const totalCost = roundAmountPrecise(costPerHour * (downtimeSeconds / 3600));

    return {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      costPerHour,
      totalCost,
      recoveryCost,
      rtoMinutes,
      impactedAtSeconds,
      downtimeSeconds,
      downtimeMinutes: roundAmountPrecise(downtimeSeconds / 60),
      costSource,
      costSourceLabel,
      recoveryStrategy: strategySelection.strategy,
      monthlyDrCost: roundAmount(strategySelection.monthlyDrCost),
      recoveryActivationFactor,
    } satisfies WarRoomNodeCost;
  });

  const computedHourlyDowntimeCost = roundAmount(
    nodeCosts.reduce((sum, node) => sum + node.costPerHour, 0),
  );
  const hourlyDowntimeCost =
    computedHourlyDowntimeCost > 0
      ? computedHourlyDowntimeCost
      : roundAmount(resolvedProfile.hourlyDowntimeCost);
  const recoveryCostEstimate = roundAmount(
    nodeCosts.reduce((sum, node) => sum + node.recoveryCost, 0),
  );
  const cumulativeLossTimeline = computeCumulativeLossTimeline(
    nodeCosts,
    totalDowntimeSeconds,
    result.warRoomData?.propagationTimeline || [],
  );
  const projectedBusinessLoss =
    cumulativeLossTimeline[cumulativeLossTimeline.length - 1]?.cumulativeBusinessLoss ??
    roundAmountPrecise(nodeCosts.reduce((sum, node) => sum + node.totalCost, 0));

  const biaConfiguredCount = nodeCosts.filter((node) => node.costSource === 'bia_configured').length;
  const biaCoverageRatio =
    nodeCosts.length > 0
      ? roundAmountPrecise(biaConfiguredCount / nodeCosts.length)
      : 0;
  const costConfidence: WarRoomFinancial['costConfidence'] =
    biaCoverageRatio > 0.5
      ? 'reliable'
      : biaCoverageRatio >= 0.2
        ? 'approximate'
        : 'gross';
  const costConfidenceLabel =
    costConfidence === 'reliable'
      ? 'Estimation fiable'
      : costConfidence === 'approximate'
        ? 'Estimation approximative'
        : 'Estimation grossiere - configurez le profil financier';
  const nodeCostBreakdown = nodeCosts
    .sort((a, b) => b.totalCost - a.totalCost)
    .map((node) => ({
      nodeId: node.nodeId,
      nodeName: node.nodeName,
      nodeType: node.nodeType,
      costPerHour: node.costPerHour,
      totalCost: roundAmountPrecise(node.totalCost),
      recoveryCost: node.recoveryCost,
      rtoMinutes: node.rtoMinutes,
      downtimeMinutes: node.downtimeMinutes,
      downtimeSeconds: node.downtimeSeconds,
      impactedAtSeconds: node.impactedAtSeconds,
      costSource: node.costSource,
      costSourceLabel: node.costSourceLabel,
      recoveryStrategy: node.recoveryStrategy,
      monthlyDrCost: node.monthlyDrCost,
      recoveryActivationFactor: node.recoveryActivationFactor,
    }));

  return {
    hourlyDowntimeCost,
    recoveryCostEstimate,
    projectedBusinessLoss: roundAmountPrecise(projectedBusinessLoss),
    totalDurationSeconds: totalDowntimeSeconds,
    totalDurationMinutes: roundAmountPrecise(totalDowntimeSeconds / 60),
    costConfidence,
    costConfidenceLabel,
    biaCoverageRatio,
    trackedNodeCount: nodeCosts.length,
    cumulativeLossTimeline,
    nodeCostBreakdown,
  };
}

// ─── POST /simulations — Run a simulation ──────────
router.post('/', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { scenarioType, params, name } = req.body;

    if (!scenarioType) {
      return res.status(400).json({ error: 'scenarioType is required' });
    }

    if (String(scenarioType).toLowerCase() === 'custom') {
      let nextCalled = false;
      await new Promise<void>((resolve) => {
        requireFeature('war-room-custom')(req as any, res, () => {
          nextCalled = true;
          resolve();
        });
        if (!nextCalled && res.headersSent) {
          resolve();
        }
      });
      if (!nextCalled) {
        return;
      }
    }

    const graph = await GraphService.getGraph(prisma, tenantId);

    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    const result = runSimulation(graph, {
      scenarioType,
      params: params || {},
      name,
    });

    let warRoomFinancial: WarRoomFinancial;
    try {
      warRoomFinancial = await buildWarRoomFinancial(tenantId, result);
    } catch (error) {
      appLogger.error('Error building simulation financial metrics:', error);
      warRoomFinancial = buildFallbackWarRoomFinancial(result);
    }

    const resultWithFinancial: SimulationResult = {
      ...result,
      warRoomFinancial,
      metrics: {
        ...result.metrics,
        estimatedFinancialLoss:
          warRoomFinancial.projectedBusinessLoss > 0
            ? warRoomFinancial.projectedBusinessLoss
            : result.metrics.estimatedFinancialLoss,
      },
    };

    // Persist simulation
    await prisma.simulation.create({
      data: {
        id: resultWithFinancial.id,
        name: name || null,
        scenarioType,
        scenarioParams: params || {},
        result: resultWithFinancial as any,
        totalNodesAffected: resultWithFinancial.metrics.totalNodesAffected,
        percentageAffected: resultWithFinancial.metrics.percentageInfraAffected,
        estimatedDowntime: resultWithFinancial.metrics.estimatedDowntimeMinutes,
        estimatedFinancialLoss: resultWithFinancial.metrics.estimatedFinancialLoss,
        postIncidentScore: resultWithFinancial.postIncidentResilienceScore,
        tenantId,
      },
    });

    return res.json(resultWithFinancial);
  } catch (error) {
    appLogger.error('Error running simulation:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /simulations — List past simulations ──────────
router.get('/', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const simulations = await prisma.simulation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        scenarioType: true,
        totalNodesAffected: true,
        percentageAffected: true,
        estimatedDowntime: true,
        estimatedFinancialLoss: true,
        postIncidentScore: true,
        createdAt: true,
      },
    });

    return res.json({ simulations });
  } catch (error) {
    appLogger.error('Error listing simulations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /simulations/templates — Available scenario templates ──────────
router.get('/templates', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);
    const dynamicOptions = getScenarioOptions(graph);

    const templates = SCENARIO_LIBRARY.map((template) => ({
      ...template,
      configurableParams: template.configurableParams.map((param) => {
        if (param.default === 'dynamic_regions') {
          const regions = dynamicOptions.regions ?? [];
          return { ...param, options: regions, default: regions[0] ?? 'unknown-region' };
        }
        if (param.default === 'dynamic_azs') {
          const azs = dynamicOptions.azs ?? [];
          return { ...param, options: azs, default: azs[0] ?? 'unknown-az' };
        }
        return param;
      }),
    }));

    return res.json({ templates, dynamicOptions });
  } catch (error) {
    appLogger.error('Error fetching simulation templates:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /simulations/recovery-priorities — Tiered recovery plan ──────────
router.get('/recovery-priorities', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);
    const priorities = computeRecoveryPriorities(graph);

    return res.json({
      priorities,
      summary: {
        total: priorities.length,
        T0: priorities.filter((p) => p.tier === 'T0').length,
        T1: priorities.filter((p) => p.tier === 'T1').length,
        T2: priorities.filter((p) => p.tier === 'T2').length,
        T3: priorities.filter((p) => p.tier === 'T3').length,
      },
    });
  } catch (error) {
    appLogger.error('Error computing recovery priorities:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /simulations/compare — Compare two simulations ──────────
// NOTE: Must be defined before /:id to avoid being caught by the parameterized route
router.get('/compare', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const idA = req.query.a as string;
    const idB = req.query.b as string;

    if (!idA || !idB) {
      return res.status(400).json({ error: 'Both a and b simulation IDs are required' });
    }

    const [simA, simB] = await Promise.all([
      prisma.simulation.findFirst({ where: { id: idA, tenantId } }),
      prisma.simulation.findFirst({ where: { id: idB, tenantId } }),
    ]);

    if (!simA || !simB) {
      return res.status(404).json({ error: 'One or both simulations not found' });
    }

    return res.json({
      simulationA: {
        id: simA.id,
        name: simA.name,
        scenarioType: simA.scenarioType,
        metrics: {
          totalNodesAffected: simA.totalNodesAffected,
          percentageAffected: simA.percentageAffected,
          estimatedDowntime: simA.estimatedDowntime,
          estimatedFinancialLoss: simA.estimatedFinancialLoss,
          postIncidentScore: simA.postIncidentScore,
        },
      },
      simulationB: {
        id: simB.id,
        name: simB.name,
        scenarioType: simB.scenarioType,
        metrics: {
          totalNodesAffected: simB.totalNodesAffected,
          percentageAffected: simB.percentageAffected,
          estimatedDowntime: simB.estimatedDowntime,
          estimatedFinancialLoss: simB.estimatedFinancialLoss,
          postIncidentScore: simB.postIncidentScore,
        },
      },
      deltas: {
        nodesAffected: simB.totalNodesAffected - simA.totalNodesAffected,
        percentageAffected: Math.round((simB.percentageAffected - simA.percentageAffected) * 10) / 10,
        estimatedDowntime: simB.estimatedDowntime - simA.estimatedDowntime,
        estimatedFinancialLoss: (simB.estimatedFinancialLoss || 0) - (simA.estimatedFinancialLoss || 0),
        resilienceScoreChange: simB.postIncidentScore - simA.postIncidentScore,
      },
    });
  } catch (error) {
    appLogger.error('Error comparing simulations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /simulations/:id — Detail of a simulation ──────────
router.get('/:id', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const simId = req.params.id as string;
    const simulation = await prisma.simulation.findFirst({
      where: { id: simId, tenantId },
    });

    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    return res.json(simulation.result);
  } catch (error) {
    appLogger.error('Error fetching simulation:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /simulations/:id — Delete a simulation ──────────
router.delete('/:id', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const simId = req.params.id as string;
    const simulation = await prisma.simulation.findFirst({
      where: { id: simId, tenantId },
    });

    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    await prisma.simulation.deleteMany({ where: { id: simId, tenantId } });
    return res.json({ deleted: true });
  } catch (error) {
    appLogger.error('Error deleting simulation:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /simulations/:id/report — Exportable simulation report ──────────
router.get('/:id/report', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const simId = req.params.id as string;
    const format = (req.query.format as string) || 'json';

    const simulation = await prisma.simulation.findFirst({
      where: { id: simId, tenantId },
    });

    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    const result = simulation.result as any;

    const report = {
      metadata: {
        id: simulation.id,
        name: simulation.name,
        scenarioType: simulation.scenarioType,
        createdAt: simulation.createdAt,
        format,
      },
      scenario: simulation.scenarioParams,
      summary: {
        totalNodesAffected: simulation.totalNodesAffected,
        percentageAffected: simulation.percentageAffected,
        estimatedDowntime: simulation.estimatedDowntime,
        estimatedFinancialLoss: simulation.estimatedFinancialLoss,
        postIncidentScore: simulation.postIncidentScore,
      },
      affectedNodes: result.affectedNodes || [],
      cascadeImpact: result.cascadeImpact || [],
      businessImpact: result.businessImpact || [],
      recommendations: result.recommendations || [],
    };

    if (format === 'json') {
      return res.json(report);
    }

    // For PDF/DOCX, return JSON with a note — actual rendering requires a template engine
    return res.json({
      ...report,
      _note: `PDF/DOCX export requires a document rendering service. Use this JSON payload with your preferred template engine.`,
    });
  } catch (error) {
    appLogger.error('Error generating simulation report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
