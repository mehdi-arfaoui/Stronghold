import type { Response, NextFunction } from 'express';
import type { TenantRequest } from './tenantMiddleware.js';
import { licenseService, LicenseNotFoundError } from '../services/licenseService.js';

// Extend TenantRequest to include quota tracking
export type LicenseRequest = TenantRequest & {
  quotaToIncrement?: {
    type: 'users' | 'storage' | 'scans' | 'documents';
    amount: number;
  };
};

/**
 * Vérifie que la licence du tenant est valide
 */
export function requireValidLicense() {
  return async (req: LicenseRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.tenantId;

      if (!tenantId) {
        return res.status(401).json({
          error: 'TENANT_NOT_IDENTIFIED',
          message: 'Tenant ID is required',
          code: 'AUTH_001',
        });
      }

      const { valid, reason } = await licenseService.isValid(tenantId);

      if (!valid) {
        return res.status(403).json({
          error: 'LICENSE_INVALID',
          message: reason,
          code: 'LICENSE_001',
        });
      }

      next();
    } catch (error) {
      console.error('License validation error:', error);
      return res.status(500).json({
        error: 'LICENSE_CHECK_FAILED',
        message: 'Unable to validate license',
      });
    }
  };
}

/**
 * Vérifie qu'une feature est activée pour le tenant
 */
export function requireFeature(feature: string) {
  return async (req: LicenseRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.tenantId;

      if (!tenantId) {
        return res.status(401).json({
          error: 'TENANT_NOT_IDENTIFIED',
          message: 'Tenant ID is required',
          code: 'AUTH_001',
        });
      }

      const hasAccess = await licenseService.hasFeature(tenantId, feature);

      if (!hasAccess) {
        return res.status(403).json({
          error: 'FEATURE_NOT_AVAILABLE',
          message: `The feature '${feature}' is not included in your current plan`,
          code: 'LICENSE_002',
          feature,
          action: 'upgrade',
          upgradeUrl: '/settings/billing',
        });
      }

      next();
    } catch (error) {
      console.error('Feature check error:', error);
      return res.status(500).json({
        error: 'FEATURE_CHECK_FAILED',
        message: 'Unable to check feature access',
      });
    }
  };
}

/**
 * Vérifie qu'un quota n'est pas dépassé
 * Note: N'incrémente pas automatiquement, utiliser incrementQuotaOnSuccess() pour ça
 */
export function requireQuota(
  quotaType: 'users' | 'storage' | 'scans' | 'documents',
  increment: number = 1
) {
  return async (req: LicenseRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.tenantId;

      if (!tenantId) {
        return res.status(401).json({
          error: 'TENANT_NOT_IDENTIFIED',
          message: 'Tenant ID is required',
          code: 'AUTH_001',
        });
      }

      const quota = await licenseService.checkQuota(tenantId, quotaType, increment);

      if (!quota.allowed) {
        return res.status(429).json({
          error: 'QUOTA_EXCEEDED',
          message: `Your ${quotaType} quota has been exceeded`,
          code: 'LICENSE_003',
          quota: {
            type: quotaType,
            current: quota.current,
            max: quota.max,
            requested: increment,
            remaining: quota.remaining,
          },
          action: 'upgrade',
          upgradeUrl: '/settings/billing',
        });
      }

      // Stocker pour incrémenter après succès
      req.quotaToIncrement = { type: quotaType, amount: increment };

      next();
    } catch (error) {
      console.error('Quota check error:', error);
      return res.status(500).json({
        error: 'QUOTA_CHECK_FAILED',
        message: 'Unable to check quota',
      });
    }
  };
}

/**
 * Incrémente le quota après une réponse réussie (2xx)
 * À utiliser APRÈS requireQuota()
 */
export function incrementQuotaOnSuccess() {
  return (req: LicenseRequest, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: unknown) {
      // Incrémenter seulement si succès et quota à incrémenter
      if (res.statusCode >= 200 && res.statusCode < 300 && req.quotaToIncrement && req.tenantId) {
        const { type, amount } = req.quotaToIncrement;
        const tenantId = req.tenantId;

        // Fire and forget - ne pas bloquer la réponse
        licenseService.incrementUsage(tenantId, type, amount)
          .catch(err => console.error('Failed to increment quota:', err));
      }

      return originalJson(body);
    };

    next();
  };
}

/**
 * Combine plusieurs checks en un seul middleware array
 */
export function requireLicenseAccess(options: {
  feature?: string;
  quota?: {
    type: 'users' | 'storage' | 'scans' | 'documents';
    increment?: number;
  };
}) {
  // Using any[] to avoid complex Express middleware type constraints
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const middlewares: any[] = [
    requireValidLicense()
  ];

  if (options.feature) {
    middlewares.push(requireFeature(options.feature));
  }

  if (options.quota) {
    middlewares.push(requireQuota(options.quota.type, options.quota.increment || 1));
    middlewares.push(incrementQuotaOnSuccess());
  }

  return middlewares;
}
