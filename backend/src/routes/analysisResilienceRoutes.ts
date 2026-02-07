// ============================================================
// Analysis Resilience Routes — SPOF, redundancy, resilience score
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';

const router = Router();

// ─── POST /analysis/resilience — Run full graph analysis ──────────
router.post('/', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);

    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    const report = await analyzeFullGraph(graph);

    // Persist analysis
    await prisma.graphAnalysis.create({
      data: {
        resilienceScore: report.resilienceScore,
        totalNodes: report.totalNodes,
        totalEdges: report.totalEdges,
        spofCount: report.spofs.length,
        report: JSON.parse(JSON.stringify({
          spofs: report.spofs,
          redundancyIssues: report.redundancyIssues,
          regionalRisks: report.regionalRisks,
          circularDeps: report.circularDeps,
          cascadeChains: report.cascadeChains.slice(0, 20),
          criticalityScores: Object.fromEntries(report.criticalityScores),
        })),
        tenantId,
      },
    });

    // Update node scores in DB
    for (const [nodeId, score] of report.criticalityScores) {
      const spof = report.spofs.find(s => s.nodeId === nodeId);
      const blast = GraphService.getBlastRadius(graph, nodeId);

      await prisma.infraNode.updateMany({
        where: { id: nodeId, tenantId },
        data: {
          criticalityScore: score,
          isSPOF: !!spof,
          blastRadius: blast.length,
        },
      });
    }

    return res.json({
      resilienceScore: report.resilienceScore,
      totalNodes: report.totalNodes,
      totalEdges: report.totalEdges,
      spofs: report.spofs,
      redundancyIssues: report.redundancyIssues,
      regionalRisks: report.regionalRisks,
      circularDeps: report.circularDeps,
      cascadeChains: report.cascadeChains.slice(0, 20),
    });
  } catch (error) {
    console.error('Error running graph analysis:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /analysis/resilience/score — Latest resilience score ──────────
router.get('/score', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const latest = await prisma.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      return res.json({ score: null, message: 'No analysis has been run yet' });
    }

    const history = await prisma.graphAnalysis.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        resilienceScore: true,
        createdAt: true,
        spofCount: true,
        totalNodes: true,
      },
    });

    return res.json({
      score: latest.resilienceScore,
      totalNodes: latest.totalNodes,
      totalEdges: latest.totalEdges,
      spofCount: latest.spofCount,
      lastAnalyzed: latest.createdAt,
      trend: history.reverse(),
    });
  } catch (error) {
    console.error('Error fetching resilience score:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /analysis/resilience/spofs — List SPOFs ──────────
router.get('/spofs', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const latest = await prisma.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      return res.json({ spofs: [], message: 'No analysis has been run yet' });
    }

    const report = latest.report as any;
    let spofs = report.spofs || [];

    // Filter by severity if requested
    const severity = req.query.severity as string;
    if (severity) {
      const allowed = severity.split(',');
      spofs = spofs.filter((s: any) => allowed.includes(s.severity));
    }

    return res.json({ spofs, lastAnalyzed: latest.createdAt });
  } catch (error) {
    console.error('Error fetching SPOFs:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /analysis/resilience/redundancy-issues ──────────
router.get('/redundancy-issues', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const latest = await prisma.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      return res.json({ issues: [], message: 'No analysis has been run yet' });
    }

    const report = latest.report as any;
    return res.json({
      issues: report.redundancyIssues || [],
      lastAnalyzed: latest.createdAt,
    });
  } catch (error) {
    console.error('Error fetching redundancy issues:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /analysis/resilience/regional-risks ──────────
router.get('/regional-risks', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const latest = await prisma.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      return res.json({ risks: [], message: 'No analysis has been run yet' });
    }

    const report = latest.report as any;
    return res.json({
      risks: report.regionalRisks || [],
      lastAnalyzed: latest.createdAt,
    });
  } catch (error) {
    console.error('Error fetching regional risks:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
