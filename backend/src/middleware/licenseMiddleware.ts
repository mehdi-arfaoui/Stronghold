import type { NextFunction, Request, Response } from 'express';
import type { TenantRequest } from './tenantMiddleware.js';
import type { LicenseService } from '../services/licenseService.js';
import type { LicensePlan } from '../config/licensePlans.js';
import type { LicenseStatus } from '../types/license.js';

export type LicenseRequest = TenantRequest;

const PLAN_RANK: Record<LicensePlan, number> = {
  starter: 0,
  pro: 1,
  enterprise: 2,
};

const LICENSE_STATUS_MESSAGES: Record<LicenseStatus, string> = {
  valid: 'Licence active.',
  grace_period: 'Votre licence Stronghold a expire. Contactez support@stronghold.io pour renouveler.',
  expired: 'Votre licence Stronghold a expire. Contactez support@stronghold.io pour renouveler.',
  fingerprint_mismatch: 'Cette licence est liee a un autre serveur. Contactez support@stronghold.io.',
  invalid_signature: 'Licence invalide. Verifiez votre fichier de licence.',
  not_found: 'Aucune licence trouvee. Veuillez activer Stronghold.',
  error: 'Une erreur est survenue lors de la verification de la licence.',
};

function getLicenseService(req: Request): LicenseService | null {
  return (req.app.locals.licenseService as LicenseService | undefined) ?? null;
}

export function isDemoLicenseBypassEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const buildTarget = String(env.BUILD_TARGET || '').toLowerCase();
  if (buildTarget !== 'internal') {
    return false;
  }

  const nodeEnv = String(env.NODE_ENV || 'development').toLowerCase();
  const allowDemoSeed = String(env.ALLOW_DEMO_SEED || '').toLowerCase() === 'true';
  const appEnv = String(env.APP_ENV || env.DEPLOYMENT_STAGE || '').toLowerCase();
  const explicitDemoContext = appEnv.includes('demo');

  if (nodeEnv === 'production') {
    return allowDemoSeed || explicitDemoContext;
  }

  return nodeEnv === 'development' || nodeEnv === 'test' || allowDemoSeed || explicitDemoContext;
}

function sendLicenseError(res: Response, status: LicenseStatus) {
  return res.status(403).json({
    error: 'LICENSE_INVALID',
    licenseStatus: status,
    message: LICENSE_STATUS_MESSAGES[status],
  });
}

export function getLicenseStatusMessage(status: LicenseStatus): string {
  return LICENSE_STATUS_MESSAGES[status];
}

export function requireLicense(req: Request, res: Response, next: NextFunction) {
  if (isDemoLicenseBypassEnabled()) {
    return next();
  }

  const license = getLicenseService(req);
  if (!license) {
    return res.status(500).json({
      error: 'LICENSE_SERVICE_UNAVAILABLE',
      message: 'License service is not initialized.',
    });
  }

  if (!license.isOperational()) {
    return sendLicenseError(res, license.getStatus());
  }

  if (license.getStatus() === 'grace_period') {
    res.setHeader('X-License-Warning', LICENSE_STATUS_MESSAGES.grace_period);
  }

  return next();
}

export function requireValidLicense() {
  return requireLicense;
}

export function requireFeature(feature: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isDemoLicenseBypassEnabled()) {
      return next();
    }

    const license = getLicenseService(req);
    if (!license) {
      return res.status(500).json({
        error: 'LICENSE_SERVICE_UNAVAILABLE',
        message: 'License service is not initialized.',
      });
    }

    if (!license.isOperational()) {
      return sendLicenseError(res, license.getStatus());
    }

    if (!license.hasFeature(feature)) {
      return res.status(403).json({
        error: 'FEATURE_NOT_AVAILABLE',
        feature,
        currentPlan: license.getPlan(),
        message: `Cette fonctionnalite n'est pas disponible avec votre plan actuel.`,
      });
    }

    return next();
  };
}

export function requirePlan(minimumPlan: LicensePlan) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isDemoLicenseBypassEnabled()) {
      return next();
    }

    const license = getLicenseService(req);
    if (!license) {
      return res.status(500).json({
        error: 'LICENSE_SERVICE_UNAVAILABLE',
        message: 'License service is not initialized.',
      });
    }

    if (!license.isOperational()) {
      return sendLicenseError(res, license.getStatus());
    }

    const currentPlan = license.getPlan();
    if (!currentPlan || PLAN_RANK[currentPlan] < PLAN_RANK[minimumPlan]) {
      return res.status(403).json({
        error: 'PLAN_INSUFFICIENT',
        requiredPlan: minimumPlan,
        currentPlan,
        message: `Cette fonctionnalite necessite au minimum le plan ${minimumPlan}.`,
      });
    }

    return next();
  };
}

export function requireQuota(_quotaType: 'users' | 'storage' | 'scans' | 'documents', _increment = 1) {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}

export function incrementQuotaOnSuccess() {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}

export function requireLicenseAccess(options: { feature?: string; minimumPlan?: LicensePlan }) {
  const middlewares = [requireLicense];
  if (options.feature) {
    middlewares.push(requireFeature(options.feature));
  }
  if (options.minimumPlan) {
    middlewares.push(requirePlan(options.minimumPlan));
  }
  return middlewares;
}
