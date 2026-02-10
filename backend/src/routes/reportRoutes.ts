// ============================================================
// PRA/PCA Report Routes — Intelligent report generation
// ============================================================

import { Router, type Response } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { generatePraPcaReport } from '../graph/reportGenerator.js';

const router = Router();

async function getDataAvailability(tenantId: string) {
  const [nodeCount, analysisCount, biaCount, simCount] = await Promise.all([
    prisma.infraNode.count({ where: { tenantId } }),
    prisma.graphAnalysis.count({ where: { tenantId } }),
    prisma.bIAReport2.count({ where: { tenantId } }),
    prisma.simulation.count({ where: { tenantId } }),
  ]);

  return {
    infrastructureNodes: nodeCount,
    analysisRuns: analysisCount,
    biaReports: biaCount,
    simulations: simCount,
    readyToGenerate: nodeCount > 0,
  };
}

async function handleReportGeneration(req: TenantRequest, res: Response) {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

  const {
    includeSimulations,
    includeExercises,
    format = 'json',
    sections,
  } = req.body;

  const nodeCount = await prisma.infraNode.count({ where: { tenantId } });
  if (nodeCount === 0) {
    return res.status(400).json({
      error: 'No infrastructure data available. Run a discovery scan first.',
    });
  }

  const report = await generatePraPcaReport(prisma, tenantId, {
    includeSimulations,
    includeExercises,
    format: format || 'json',
    sections,
  });

  if (format === 'json') {
    return res.json(report);
  }

  return res.json({
    ...report,
    _renderingNote: 'PDF/DOCX generation available. Use this JSON payload with your document rendering service. The report structure follows ISO 22301:2019 sections.',
  });
}

// ─── POST /reports/pra-pca — Generate PRA/PCA report ──────────
router.post('/pra-pca', async (req: TenantRequest, res) => {
  try {
    return await handleReportGeneration(req, res);
  } catch (error) {
    console.error('Error generating PRA/PCA report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Compatibility route for frontend report generator
router.post('/generate', async (req: TenantRequest, res) => {
  try {
    req.body = { ...req.body, format: req.body?.format ?? 'pdf' };
    return await handleReportGeneration(req, res);
  } catch (error) {
    console.error('Error generating PRA/PCA report (compat):', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /reports/pra-pca/latest — Get latest report metadata ──────────
router.get('/pra-pca/latest', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    return res.json({
      dataAvailability: await getDataAvailability(tenantId),
    });
  } catch (error) {
    console.error('Error fetching report metadata:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Frontend prerequisites list used to unlock PRA/PCA generation button
router.get('/prerequisites', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const data = await getDataAvailability(tenantId);

    return res.json([
      {
        id: 'infrastructure',
        label: 'Infrastructure decouverte',
        met: data.infrastructureNodes > 0,
        details: `${data.infrastructureNodes} noeud(s)`,
      },
      {
        id: 'bia',
        label: 'Analyse BIA disponible',
        met: data.biaReports > 0,
        details: `${data.biaReports} rapport(s) BIA`,
      },
      {
        id: 'simulations',
        label: 'Simulation de resilience executee',
        met: data.simulations > 0,
        details: `${data.simulations} simulation(s)`,
      },
    ]);
  } catch (error) {
    console.error('Error fetching report prerequisites:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
