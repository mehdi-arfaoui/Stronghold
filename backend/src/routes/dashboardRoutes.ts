import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { requireRole } from '../middleware/tenantMiddleware.js';
import {
  DEFAULT_DASHBOARD_LAYOUT,
  sanitizeDashboardLayout,
} from '../constants/dashboardWidgets.js';
import { appLogger } from '../utils/logger.js';
import { toPrismaJson } from '../utils/prismaJson.js';

const router = Router();

function resolveDashboardContext(req: TenantRequest) {
  const organizationId = req.tenantId;
  const userId = req.user?.id;

  return {
    organizationId,
    userId,
  };
}

router.get('/config', requireRole('READER'), async (req: TenantRequest, res) => {
  try {
    const { organizationId, userId } = resolveDashboardContext(req);
    if (!organizationId) {
      return res.status(500).json({ error: 'Tenant not resolved' });
    }
    if (!userId) {
      return res.status(401).json({ error: 'Authenticated user required' });
    }

    const config = await prisma.dashboardConfig.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      select: {
        layout: true,
      },
    });

    if (!config) {
      return res.json(DEFAULT_DASHBOARD_LAYOUT);
    }

    const cleanLayout = sanitizeDashboardLayout(config.layout);
    if (cleanLayout.length === 0 && Array.isArray(config.layout) && config.layout.length > 0) {
      return res.json(DEFAULT_DASHBOARD_LAYOUT);
    }
    return res.json(cleanLayout);
  } catch (error) {
    appLogger.error('Error in GET /dashboard/config', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/config', requireRole('READER'), async (req: TenantRequest, res) => {
  try {
    const { organizationId, userId } = resolveDashboardContext(req);
    if (!organizationId) {
      return res.status(500).json({ error: 'Tenant not resolved' });
    }
    if (!userId) {
      return res.status(401).json({ error: 'Authenticated user required' });
    }

    const layout = req.body?.layout;
    if (!Array.isArray(layout)) {
      return res.status(400).json({ error: 'Layout must be an array' });
    }

    const validatedLayout = sanitizeDashboardLayout(layout);
    const layoutJson = toPrismaJson(validatedLayout);
    const config = await prisma.dashboardConfig.upsert({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      create: {
        userId,
        organizationId,
        layout: layoutJson,
      },
      update: {
        layout: layoutJson,
      },
    });

    return res.json(config);
  } catch (error) {
    appLogger.error('Error in PUT /dashboard/config', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
