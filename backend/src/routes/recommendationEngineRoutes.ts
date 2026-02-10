import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { generateHybridRecommendations } from '../recommendations/services/recommendation-engine.service.js';

const router = Router();

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
    console.error('Error generating hybrid recommendations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
