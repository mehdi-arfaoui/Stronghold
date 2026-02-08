// ============================================================
// Simulation Routes — What-if scenario simulations
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { runSimulation, SCENARIO_TEMPLATES, getScenarioOptions } from '../graph/simulationEngine.js';

const router = Router();

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

    // Persist simulation
    await prisma.simulation.create({
      data: {
        id: result.id,
        name: name || null,
        scenarioType,
        scenarioParams: params || {},
        result: result as any,
        totalNodesAffected: result.metrics.totalNodesAffected,
        percentageAffected: result.metrics.percentageInfraAffected,
        estimatedDowntime: result.metrics.estimatedDowntimeMinutes,
        estimatedFinancialLoss: result.metrics.estimatedFinancialLoss,
        postIncidentScore: result.postIncidentResilienceScore,
        tenantId,
      },
    });

    return res.json(result);
  } catch (error) {
    console.error('Error running simulation:', error);
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
    console.error('Error listing simulations:', error);
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

    const templates = SCENARIO_TEMPLATES.map(t => ({
      ...t,
      dynamicOptions: {
        regions: dynamicOptions.regions,
        azs: dynamicOptions.azs,
        databases: dynamicOptions.databases,
        vpcs: dynamicOptions.vpcs,
        thirdParty: dynamicOptions.thirdParty,
      },
    }));

    return res.json({ templates });
  } catch (error) {
    console.error('Error fetching simulation templates:', error);
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
    console.error('Error fetching simulation:', error);
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

    await prisma.simulation.delete({ where: { id: simId } });
    return res.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting simulation:', error);
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
    console.error('Error generating simulation report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /simulations/compare — Compare two simulations ──────────
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
    console.error('Error comparing simulations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
