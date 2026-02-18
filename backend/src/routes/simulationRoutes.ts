import { appLogger } from "../utils/logger.js";
// ============================================================
// Simulation Routes — What-if scenario simulations
// ============================================================

import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { runSimulation, getScenarioOptions } from '../graph/simulationEngine.js';
import { SCENARIO_LIBRARY } from '../simulations/data/scenario-library.js';
import { computeRecoveryPriorities } from '../simulations/recovery-priority.js';
import {
  FinancialEngineService,
  type FinancialNodeInput,
  type FinancialOrganizationProfileInput,
  type NodeFinancialOverrideInput,
} from '../services/financial-engine.service.js';
import { BusinessFlowFinancialEngineService } from '../services/business-flow-financial-engine.service.js';
import type { SimulationResult, WarRoomFinancial } from '../graph/types.js';

const router = Router();

type InfraNodeWithEdges = Prisma.InfraNodeGetPayload<{
  include: {
    inEdges: true;
    outEdges: true;
  };
}>;

type SimulationRtoSource = {
  validatedRTO: number | null;
  suggestedRTO: number | null;
};

type WarRoomNodeCost = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  costPerHour: number;
  recoveryCost: number;
  rtoMinutes: number;
  impactedAt: number;
};

function roundAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
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
    dependentsCount: node.inEdges.length,
    inEdges: node.inEdges,
    outEdges: node.outEdges,
  };
}

function toProfileInput(
  profile: Prisma.OrganizationProfileGetPayload<Record<string, never>> | null,
): FinancialOrganizationProfileInput {
  if (!profile) {
    return {
      sizeCategory: 'midMarket',
      customCurrency: 'EUR',
    };
  }
  return {
    sizeCategory: profile.sizeCategory,
    verticalSector: profile.verticalSector,
    customDowntimeCostPerHour: profile.customDowntimeCostPerHour,
    customCurrency: profile.customCurrency,
    strongholdPlanId: profile.strongholdPlanId,
    strongholdMonthlyCost: profile.strongholdMonthlyCost,
  };
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveImpactedAtByNodeId(result: SimulationResult): Map<string, number> {
  const byNodeId = new Map<string, number>();
  for (const node of result.directlyAffected || []) {
    byNodeId.set(node.id, 0);
  }
  for (const node of result.cascadeImpacted || []) {
    const previous = byNodeId.get(node.id);
    const next = Math.max(0, Number(node.cascadeDepth || 0));
    if (previous == null || next < previous) {
      byNodeId.set(node.id, next);
    }
  }
  for (const node of result.warRoomData?.impactedNodes || []) {
    const previous = byNodeId.get(node.id);
    const next = Math.max(0, Number(node.impactedAt || 0));
    if (previous == null || next < previous) {
      byNodeId.set(node.id, next);
    }
  }
  return byNodeId;
}

function resolveRtoMinutes(
  node: InfraNodeWithEdges,
  processByNodeId: Map<string, SimulationRtoSource>,
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
  totalDowntimeMinutes: number,
  timeline: SimulationResult['warRoomData']['propagationTimeline'],
): WarRoomFinancial['cumulativeLossTimeline'] {
  const points = new Set<number>([0, totalDowntimeMinutes]);
  for (const event of timeline || []) {
    points.add(clamp(Number(event.timestampMinutes || 0), 0, totalDowntimeMinutes));
  }

  const ordered = Array.from(points).sort((a, b) => a - b);
  const rows: WarRoomFinancial['cumulativeLossTimeline'] = [];
  let cumulative = 0;
  let previousMinute = 0;

  for (const minute of ordered) {
    const activeHourlyCost = nodeCosts.reduce((sum, node) => (
      node.impactedAt <= minute ? sum + node.costPerHour : sum
    ), 0);
    const deltaMinutes = Math.max(0, minute - previousMinute);
    cumulative += activeHourlyCost * (deltaMinutes / 60);
    rows.push({
      timestampMinutes: roundAmount(minute),
      cumulativeBusinessLoss: roundAmount(cumulative),
      activeHourlyCost: roundAmount(activeHourlyCost),
    });
    previousMinute = minute;
  }

  return rows;
}

function buildFallbackWarRoomFinancial(result: SimulationResult): WarRoomFinancial {
  const estimatedDowntime = Math.max(1, normalizePositiveNumber(result.metrics.estimatedDowntimeMinutes, 60));
  const hourlyCost = roundAmount(
    normalizePositiveNumber(result.metrics.estimatedFinancialLoss, 0) /
      Math.max(estimatedDowntime / 60, 1),
  );
  const projectedBusinessLoss = roundAmount(result.metrics.estimatedFinancialLoss || 0);
  return {
    hourlyDowntimeCost: hourlyCost,
    recoveryCostEstimate: roundAmount(projectedBusinessLoss * 0.25),
    projectedBusinessLoss,
    cumulativeLossTimeline: [
      { timestampMinutes: 0, cumulativeBusinessLoss: 0, activeHourlyCost: hourlyCost },
      {
        timestampMinutes: roundAmount(estimatedDowntime),
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

  const [nodes, latestBia, profile, overrides] = await Promise.all([
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
            validationStatus: true,
          },
        },
      },
    }),
    prisma.organizationProfile.findUnique({
      where: { tenantId },
    }),
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

  const processByNodeId = new Map<string, SimulationRtoSource>();
  for (const process of latestBia?.processes || []) {
    if (process.validationStatus !== 'validated') continue;
    processByNodeId.set(process.serviceNodeId, {
      validatedRTO: process.validatedRTO,
      suggestedRTO: process.suggestedRTO,
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
  const impactedAtByNodeId = resolveImpactedAtByNodeId(result);
  const profileInput = toProfileInput(profile);
  const flowEngine = new BusinessFlowFinancialEngineService(prisma);

  const nodeCosts = await Promise.all(
    nodes.map(async (node) => {
      const financialNode = toFinancialNodeInput(node);
      const override = overrideByNodeId.get(node.id);
      const flowCost = await flowEngine.calculateNodeCostFromFlows({
        tenantId,
        nodeId: node.id,
        node: financialNode,
        orgProfile: profileInput,
        ...(override ? { override } : {}),
        includeUnvalidatedFlows: true,
        applyCloudCostFactor: true,
      });

      const fallbackImpact = FinancialEngineService.calculateNodeFinancialImpact(
        financialNode,
        profileInput,
        override,
      );

      const costPerHour = roundAmount(
        flowCost.totalCostPerHour > 0
          ? flowCost.totalCostPerHour
          : fallbackImpact.estimatedCostPerHour,
      );
      const rtoMinutes = resolveRtoMinutes(node, processByNodeId, fallbackRtoMinutes);
      const recoveryFactor = clamp(rtoMinutes / 180, 0.35, 1.5);
      const recoveryCost = roundAmount(costPerHour * recoveryFactor);
      const impactedAt = clamp(
        Number(impactedAtByNodeId.get(node.id) ?? 0),
        0,
        Math.max(1, fallbackRtoMinutes),
      );

      return {
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        costPerHour,
        recoveryCost,
        rtoMinutes,
        impactedAt,
      } satisfies WarRoomNodeCost;
    }),
  );

  const hourlyDowntimeCost = roundAmount(
    nodeCosts.reduce((sum, node) => sum + node.costPerHour, 0),
  );
  const recoveryCostEstimate = roundAmount(
    nodeCosts.reduce((sum, node) => sum + node.recoveryCost, 0),
  );

  const totalDowntimeMinutes = Math.max(
    fallbackRtoMinutes,
    ...nodeCosts.map((node) => node.rtoMinutes),
  );
  const cumulativeLossTimeline = computeCumulativeLossTimeline(
    nodeCosts,
    totalDowntimeMinutes,
    result.warRoomData?.propagationTimeline || [],
  );
  const projectedBusinessLoss =
    cumulativeLossTimeline[cumulativeLossTimeline.length - 1]?.cumulativeBusinessLoss ??
    roundAmount(
      nodeCosts.reduce(
        (sum, node) => sum + (node.costPerHour * node.rtoMinutes) / 60,
        0,
      ),
    );

  const nodeCostBreakdown = nodeCosts
    .sort((a, b) => b.costPerHour - a.costPerHour)
    .map((node) => ({
      nodeId: node.nodeId,
      nodeName: node.nodeName,
      nodeType: node.nodeType,
      costPerHour: node.costPerHour,
      recoveryCost: node.recoveryCost,
      rtoMinutes: node.rtoMinutes,
    }));

  return {
    hourlyDowntimeCost,
    recoveryCostEstimate,
    projectedBusinessLoss,
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
