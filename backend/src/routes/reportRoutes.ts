// ============================================================
// PRA/PCA Report Routes — Intelligent report generation
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { generatePraPcaReport } from '../graph/reportGenerator.js';

const router = Router();

// ─── POST /reports/pra-pca — Generate PRA/PCA report ──────────
router.post('/pra-pca', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const {
      includeSimulations,
      includeExercises,
      format = 'json',
      sections,
    } = req.body;

    // Validate graph has data
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

    // For PDF/DOCX format, return JSON with rendering instructions
    // Actual PDF rendering requires a template engine (e.g., puppeteer, docx-templates)
    return res.json({
      ...report,
      _renderingNote: `PDF/DOCX generation available. Use this JSON payload with your document rendering service. The report structure follows ISO 22301:2019 sections.`,
    });
  } catch (error) {
    console.error('Error generating PRA/PCA report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /reports/pra-pca/latest — Get latest report metadata ──────────
router.get('/pra-pca/latest', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    // Check if we have enough data to generate
    const [nodeCount, analysisCount, biaCount, simCount] = await Promise.all([
      prisma.infraNode.count({ where: { tenantId } }),
      prisma.graphAnalysis.count({ where: { tenantId } }),
      prisma.bIAReport2.count({ where: { tenantId } }),
      prisma.simulation.count({ where: { tenantId } }),
    ]);

    return res.json({
      dataAvailability: {
        infrastructureNodes: nodeCount,
        analysisRuns: analysisCount,
        biaReports: biaCount,
        simulations: simCount,
        readyToGenerate: nodeCount > 0,
      },
    });
  } catch (error) {
    console.error('Error fetching report metadata:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
