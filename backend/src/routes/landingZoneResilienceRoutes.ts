// ============================================================
// Landing Zone Resilience Routes — Recovery recommendations
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { generateBIA } from '../graph/biaEngine.js';
import { generateLandingZoneRecommendations } from '../graph/landingZoneService.js';

const router = Router();

// ─── GET /recommendations/landing-zone — Generate landing zone recommendations ──────────
router.get('/', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);

    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    const analysis = await analyzeFullGraph(graph);
    const bia = generateBIA(graph, analysis);
    const report = generateLandingZoneRecommendations(bia, analysis);

    return res.json(report);
  } catch (error) {
    console.error('Error generating landing zone recommendations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /recommendations/landing-zone — Accept/reject recommendations ──────────
router.patch('/', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { overrides } = req.body;
    if (!overrides || !Array.isArray(overrides)) {
      return res.status(400).json({ error: 'overrides array is required' });
    }

    // Generate current recommendations
    const graph = await GraphService.getGraph(prisma, tenantId);
    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty.' });
    }

    const analysis = await analyzeFullGraph(graph);
    const bia = generateBIA(graph, analysis);
    const report = generateLandingZoneRecommendations(bia, analysis);

    // Apply overrides
    const updatedRecommendations = report.recommendations.map(rec => {
      const override = overrides.find((o: any) => o.serviceId === rec.serviceId);
      if (override) {
        return {
          ...rec,
          accepted: override.accepted ?? true,
          notes: override.notes ?? null,
        };
      }
      return { ...rec, accepted: true, notes: null };
    });

    // Persist accepted status in infra nodes
    for (const rec of updatedRecommendations) {
      if (rec.accepted && rec.strategy) {
        await prisma.infraNode.updateMany({
          where: { id: rec.serviceId, tenantId },
          data: {
            metadata: JSON.parse(JSON.stringify({
              recoveryStrategy: rec.strategy,
              landingZoneAccepted: true,
            })),
          },
        });
      }
    }

    return res.json({
      updated: updatedRecommendations.length,
      accepted: updatedRecommendations.filter((r: any) => r.accepted).length,
      rejected: updatedRecommendations.filter((r: any) => !r.accepted).length,
    });
  } catch (error) {
    console.error('Error updating landing zone recommendations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /recommendations/landing-zone/cost-summary — Cost breakdown ──────────
router.get('/cost-summary', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);

    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    const analysis = await analyzeFullGraph(graph);
    const bia = generateBIA(graph, analysis);
    const report = generateLandingZoneRecommendations(bia, analysis);

    const byTier = [1, 2, 3, 4].map(tier => {
      const items = report.recommendations.filter(r => r.recoveryTier === tier);
      return {
        tier,
        count: items.length,
        totalCost: items.reduce((sum, r) => sum + r.estimatedCost, 0),
        totalRiskOfInaction: items.reduce((sum, r) => sum + r.riskOfInaction, 0),
      };
    });

    const totalMonthlyCost = report.summary.estimatedTotalCost;
    const totalAnnualRisk = byTier.reduce((sum, t) => sum + t.totalRiskOfInaction, 0) * 8760; // hours/year

    return res.json({
      byTier,
      total: totalMonthlyCost,
      roi: {
        breakEvenMonths: totalAnnualRisk > 0
          ? Math.ceil((totalMonthlyCost * 12) / totalAnnualRisk)
          : null,
        annualProtectionValue: totalAnnualRisk,
        annualCost: totalMonthlyCost * 12,
      },
    });
  } catch (error) {
    console.error('Error generating cost summary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
