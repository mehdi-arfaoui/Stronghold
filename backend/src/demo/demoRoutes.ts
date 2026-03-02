import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { appLogger } from '../utils/logger.js';
import { getDemoSeedGuard, parseDemoProfile, runDemoOnboarding } from './index.js';

const router = Router();

router.post('/seed-demo', async (req: TenantRequest, res) => {
  try {
    const guard = getDemoSeedGuard();
    if (!guard.allowed) {
      return res.status(403).json({
        error: guard.reason,
        environment: guard.nodeEnv,
        mode: guard.mode,
      });
    }

    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const parsedProfile = parseDemoProfile(req.body);
    if (!parsedProfile.ok) {
      return res.status(400).json({
        error: parsedProfile.error,
        details: parsedProfile.details,
      });
    }

    const summary = await runDemoOnboarding(prisma, tenantId, {
      profile: parsedProfile.value,
    });

    return res.json({
      success: true,
      message: `Demo onboarding completed for "${summary.demoProfile.sectorLabel}"`,
      environment: guard.nodeEnv,
      mode: guard.mode,
      ...summary,
    });
  } catch (error) {
    appLogger.error('Error seeding demo data:', error);
    return res.status(500).json({ error: 'Failed to seed demo data' });
  }
});

export default router;
