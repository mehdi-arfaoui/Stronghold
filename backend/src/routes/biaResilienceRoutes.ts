// ============================================================
// BIA Resilience Routes — Auto-generated BIA from graph
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { generateBIA } from '../graph/biaEngine.js';

const router = Router();

// ─── POST /bia-resilience/auto-generate — Generate BIA from graph ──────────
router.post('/auto-generate', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);

    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    // Run analysis first
    const analysis = await analyzeFullGraph(graph);

    // Generate BIA
    const biaReport = generateBIA(graph, analysis);

    // Persist BIA report
    const dbReport = await prisma.bIAReport2.create({
      data: {
        generatedAt: biaReport.generatedAt,
        summary: biaReport.summary as any,
        tenantId,
        processes: {
          create: biaReport.processes.map(p => ({
            serviceNodeId: p.serviceNodeId,
            serviceName: p.serviceName,
            serviceType: p.serviceType,
            suggestedMAO: p.suggestedMAO,
            suggestedMTPD: p.suggestedMTPD,
            suggestedRTO: p.suggestedRTO,
            suggestedRPO: p.suggestedRPO,
            suggestedMBCO: p.suggestedMBCO,
            impactCategory: p.impactCategory,
            criticalityScore: p.criticalityScore,
            recoveryTier: p.recoveryTier,
            dependencyChain: p.dependencyChain as any,
            weakPoints: p.weakPoints as any,
            financialImpact: p.financialImpact as any,
            validationStatus: 'pending',
            tenantId,
          })),
        },
      },
      include: { processes: true },
    });

    // Also update node BIA data
    for (const p of biaReport.processes) {
      await prisma.infraNode.updateMany({
        where: { id: p.serviceNodeId, tenantId },
        data: {
          suggestedRTO: p.suggestedRTO,
          suggestedRPO: p.suggestedRPO,
          suggestedMTPD: p.suggestedMTPD,
          impactCategory: p.impactCategory,
          financialImpactPerHour: p.financialImpact.estimatedCostPerHour,
        },
      });
    }

    return res.json(dbReport);
  } catch (error) {
    console.error('Error generating BIA:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/report — Latest BIA report ──────────
router.get('/report', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: { orderBy: { criticalityScore: 'desc' } } },
    });

    if (!report) {
      return res.json({ report: null, message: 'No BIA has been generated yet' });
    }

    return res.json(report);
  } catch (error) {
    console.error('Error fetching BIA report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /bia-resilience/processes/:processId — Validate/adjust process ──────────
router.patch('/processes/:processId', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const processId = req.params.processId as string;
    const { validatedRTO, validatedRPO, validatedMTPD, notes, validationStatus } = req.body;

    const process = await prisma.bIAProcess2.update({
      where: { id: processId },
      data: {
        validatedRTO: validatedRTO ?? undefined,
        validatedRPO: validatedRPO ?? undefined,
        validatedMTPD: validatedMTPD ?? undefined,
        notes: notes ?? undefined,
        validationStatus: validationStatus || 'validated',
      },
    });

    // Also update the infra node
    if (validatedRTO !== undefined || validatedRPO !== undefined || validatedMTPD !== undefined) {
      await prisma.infraNode.updateMany({
        where: { id: process.serviceNodeId, tenantId },
        data: {
          validatedRTO: validatedRTO ?? undefined,
          validatedRPO: validatedRPO ?? undefined,
          validatedMTPD: validatedMTPD ?? undefined,
        },
      });
    }

    return res.json(process);
  } catch (error) {
    console.error('Error updating BIA process:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /bia-resilience/validate-all — Validate all processes at once ──────────
router.post('/validate-all', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { overrides } = req.body;

    // Get latest report
    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: true },
    });

    if (!report) {
      return res.status(400).json({ error: 'No BIA report to validate' });
    }

    // Apply overrides if provided
    const overrideMap = new Map(
      (overrides || []).map((o: any) => [o.processId, o])
    );

    for (const process of report.processes) {
      const override = overrideMap.get(process.id) as any;
      await prisma.bIAProcess2.update({
        where: { id: process.id },
        data: {
          validationStatus: 'validated',
          validatedRTO: override?.validatedRTO ?? process.suggestedRTO,
          validatedRPO: override?.validatedRPO ?? process.suggestedRPO,
          validatedMTPD: override?.validatedMTPD ?? process.suggestedMTPD,
          notes: override?.notes ?? undefined,
        },
      });
    }

    return res.json({ validated: report.processes.length });
  } catch (error) {
    console.error('Error validating BIA:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/matrix — BIA matrix by tier ──────────
router.get('/matrix', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: { orderBy: { recoveryTier: 'asc' } } },
    });

    if (!report) {
      return res.json({ tiers: [], message: 'No BIA report generated yet' });
    }

    const tierNames: Record<number, string> = {
      1: 'Mission Critical',
      2: 'Business Critical',
      3: 'Important',
      4: 'Non-Critical',
    };

    const tiers = [1, 2, 3, 4].map(tier => {
      const procs = report.processes.filter(p => p.recoveryTier === tier);
      return {
        tier,
        name: tierNames[tier],
        processes: procs,
        totalImpact: procs.reduce(
          (sum, p) => sum + ((p.financialImpact as any)?.estimatedCostPerHour || 0), 0
        ),
      };
    });

    return res.json({ tiers });
  } catch (error) {
    console.error('Error fetching BIA matrix:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
