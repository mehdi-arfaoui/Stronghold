import { appLogger } from "../utils/logger.js";
import { Router } from 'express';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { licenseService } from '../services/licenseService.js';
import { PLANS, FEATURE_REGISTRY } from '../config/plans.js';
import { requireValidLicense } from '../middleware/licenseMiddleware.js';

const router = Router();

/**
 * GET /license
 * Retourne la licence courante du tenant
 */
router.get('/', requireValidLicense(), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant not identified' });
    }

    const license = await licenseService.getLicense(tenantId);
    const plan = PLANS[license.plan as keyof typeof PLANS];

    return res.json({
      id: license.id,
      tenantId: license.tenantId,
      plan: {
        name: plan?.name ?? license.plan,
        type: license.plan,
      },
      status: license.status,
      issuedAt: license.issuedAt ?? license.startsAt,
      startsAt: license.startsAt,
      expiresAt: license.expiresAt,
      lastCheckedAt: license.lastCheckedAt ?? null,
      features: license.features,
      limits: {
        maxUsers: license.maxUsers,
        maxStorage: Number(license.maxStorage),
        maxScansMonth: license.maxScansMonth,
        maxDocuments: license.maxDocuments,
      },
      metadata: license.metadata ?? null,
    });
  } catch (error) {
    appLogger.error('Get license error:', error);
    return res.status(500).json({ error: 'Failed to get license' });
  }
});

/**
 * GET /license/usage
 * Récupère l'usage actuel de la licence
 */
router.get('/usage', requireValidLicense(), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant not identified' });
    }

    const license = await licenseService.getLicense(tenantId);
    const plan = PLANS[license.plan as keyof typeof PLANS];

    const formatBytes = (bytes: number) => {
      if (bytes === 0) return '0 B';
      if (bytes === -1) return 'Unlimited';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const calculatePercentage = (current: number, max: number) => {
      if (max === -1) return 0;
      return Math.round((current / max) * 100);
    };

    const getNextMonthStart = () => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth() + 1, 1);
    };

    const usage = license.usage;
    const currentStorage = Number(usage?.currentStorage ?? 0);
    const maxStorage = Number(license.maxStorage);

    res.json({
      plan: {
        name: plan?.name ?? license.plan,
        type: license.plan,
      },
      status: license.status,
      issuedAt: license.issuedAt ?? license.startsAt,
      startsAt: license.startsAt,
      expiresAt: license.expiresAt,
      lastCheckedAt: license.lastCheckedAt ?? null,
      quotas: {
        users: {
          current: usage?.currentUsers ?? 0,
          max: license.maxUsers,
          remaining: license.maxUsers === -1 ? -1 : license.maxUsers - (usage?.currentUsers ?? 0),
          percentage: calculatePercentage(usage?.currentUsers ?? 0, license.maxUsers),
          unlimited: license.maxUsers === -1,
        },
        storage: {
          current: currentStorage,
          max: maxStorage,
          remaining: maxStorage === -1 ? -1 : maxStorage - currentStorage,
          percentage: calculatePercentage(currentStorage, maxStorage),
          currentFormatted: formatBytes(currentStorage),
          maxFormatted: maxStorage === -1 ? 'Unlimited' : formatBytes(maxStorage),
          unlimited: maxStorage === -1,
        },
        scans: {
          current: usage?.scansThisMonth ?? 0,
          max: license.maxScansMonth,
          remaining: license.maxScansMonth === -1 ? -1 : license.maxScansMonth - (usage?.scansThisMonth ?? 0),
          percentage: calculatePercentage(usage?.scansThisMonth ?? 0, license.maxScansMonth),
          resetsAt: getNextMonthStart(),
          unlimited: license.maxScansMonth === -1,
        },
        documents: {
          current: usage?.documentsCount ?? 0,
          max: license.maxDocuments,
          remaining: license.maxDocuments === -1 ? -1 : license.maxDocuments - (usage?.documentsCount ?? 0),
          percentage: calculatePercentage(usage?.documentsCount ?? 0, license.maxDocuments),
          unlimited: license.maxDocuments === -1,
        },
      },
      features: {
        available: license.features,
        all: Object.keys(FEATURE_REGISTRY),
      },
    });
  } catch (error) {
    appLogger.error('Get license usage error:', error);
    res.status(500).json({ error: 'Failed to get license usage' });
  }
});

/**
 * GET /license/plans
 * Liste les plans disponibles (pour page pricing/upgrade)
 */
router.get('/plans', async (_req, res) => {
  const plans = Object.entries(PLANS).map(([key, plan]) => ({
    id: key,
    ...plan,
    features: (plan.features as readonly string[]).includes('*')
      ? Object.keys(FEATURE_REGISTRY)
      : plan.features,
  }));

  res.json({ plans });
});

/**
 * GET /license/features
 * Liste toutes les features avec leur description
 */
router.get('/features', async (_req, res) => {
  res.json({ features: FEATURE_REGISTRY });
});

/**
 * POST /license/check-feature
 * Vérifie si une feature est accessible
 */
router.post('/check-feature', requireValidLicense(), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant not identified' });
    }

    const { feature } = req.body;

    if (!feature) {
      return res.status(400).json({ error: 'Feature name is required' });
    }

    const hasAccess = await licenseService.hasFeature(tenantId, feature);

    res.json({
      feature,
      hasAccess,
      upgradeUrl: hasAccess ? null : '/settings/billing',
    });
  } catch (error) {
    appLogger.error('Check feature error:', error);
    res.status(500).json({ error: 'Failed to check feature' });
  }
});

/**
 * POST /license/check-quota
 * Vérifie si un quota permet une action
 */
router.post('/check-quota', requireValidLicense(), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant not identified' });
    }

    const { quotaType, increment = 1 } = req.body;

    if (!quotaType || !['users', 'storage', 'scans', 'documents'].includes(quotaType)) {
      return res.status(400).json({ error: 'Valid quota type is required (users, storage, scans, documents)' });
    }

    const quota = await licenseService.checkQuota(tenantId, quotaType, increment);

    res.json({
      quotaType,
      ...quota,
      upgradeUrl: quota.allowed ? null : '/settings/billing',
    });
  } catch (error) {
    appLogger.error('Check quota error:', error);
    res.status(500).json({ error: 'Failed to check quota' });
  }
});

export default router;
