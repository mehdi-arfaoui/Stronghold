import { appLogger } from "../utils/logger.js";
import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { generateHybridRecommendations } from '../recommendations/services/recommendation-engine.service.js';
import { requireRole } from '../middleware/authMiddleware.js';
import { regenerateRecommendationsForTenant } from '../services/recommendation-regeneration.service.js';

const router = Router();
const regenerationInProgress = new Map<string, boolean>();

router.get('/hybrid', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);
    if (graph.order === 0) {
      return res.json({ recommendations: [] });
    }

    const recommendations = generateHybridRecommendations(graph);
    return res.json({ recommendations });
  } catch (error) {
    appLogger.error('Error generating hybrid recommendations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/regenerate', requireRole('ADMIN'), async (req: TenantRequest, res) => {
  const startTime = Date.now();
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    if (regenerationInProgress.get(tenantId)) {
      return res.status(409).json({
        error: 'Un recalcul est déjà en cours. Veuillez patienter.',
      });
    }

    regenerationInProgress.set(tenantId, true);
    const result = await regenerateRecommendationsForTenant(prisma, tenantId);

    return res.json({
      success: true,
      summary: {
        ...result,
        durationMs: Date.now() - startTime,
        financialProfileConfigured: result.financialProfileConfigured,
      },
    });
  } catch (error) {
    appLogger.error('recommendations.regeneration_failed', {
      tenantId: req.tenantId,
      error: error instanceof Error ? error.message : 'unknown_error',
    });
    return res.status(500).json({ error: 'Le recalcul des recommandations a échoué.' });
  } finally {
    if (req.tenantId) {
      regenerationInProgress.set(req.tenantId, false);
    }
  }
});

export default router;
