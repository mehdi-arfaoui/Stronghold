import prisma from '../prismaClient.js';
import { redis } from '../lib/redis.js';
import { PLANS, type PlanKey } from '../config/plans.js';
import type { License, LicenseUsage } from '@prisma/client';
import type { QuotaType, QuotaCheckResult, ValidityResult, LicenseWithUsage } from '../types/license.js';

const LICENSE_CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = 'license:';

/**
 * Erreur personnalisée pour licence non trouvée
 */
export class LicenseNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`No license found for tenant ${tenantId}`);
    this.name = 'LicenseNotFoundError';
  }
}

/**
 * Service de gestion des licences pour les tenants
 */
export class LicenseService {
  /**
   * Récupère la licence d'un tenant avec cache Redis
   */
  async getLicense(tenantId: string): Promise<LicenseWithUsage> {
    const cacheKey = `${CACHE_PREFIX}${tenantId}`;

    // Vérifier le cache
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      // Redis might not be connected, continue without cache
      console.warn('Redis cache read failed:', err);
    }

    // Récupérer depuis la DB
    const license = await prisma.license.findUnique({
      where: { tenantId },
      include: { usage: true },
    });

    if (!license) {
      throw new LicenseNotFoundError(tenantId);
    }

    // Mettre en cache
    try {
      await redis.setex(cacheKey, LICENSE_CACHE_TTL, JSON.stringify(license));
    } catch (err) {
      // Redis might not be connected, continue without cache
      console.warn('Redis cache write failed:', err);
    }

    return license;
  }

  /**
   * Crée une licence pour un nouveau tenant
   */
  async createLicense(tenantId: string, plan: PlanKey = 'STARTER'): Promise<License> {
    const planConfig = PLANS[plan];

    const license = await prisma.license.create({
      data: {
        tenantId,
        plan,
        maxUsers: planConfig.maxUsers,
        maxStorage: BigInt(planConfig.maxStorage),
        maxScansMonth: planConfig.maxScansMonth,
        maxDocuments: planConfig.maxDocuments,
        features: (planConfig.features as readonly string[]).includes('*')
          ? ['*']
          : [...planConfig.features],
        usage: {
          create: {},  // Crée LicenseUsage avec valeurs par défaut
        },
      },
      include: { usage: true },
    });

    return license;
  }

  /**
   * Met à jour le plan d'une licence
   */
  async upgradePlan(tenantId: string, newPlan: PlanKey): Promise<License> {
    const planConfig = PLANS[newPlan];

    const license = await prisma.license.update({
      where: { tenantId },
      data: {
        plan: newPlan,
        maxUsers: planConfig.maxUsers,
        maxStorage: BigInt(planConfig.maxStorage),
        maxScansMonth: planConfig.maxScansMonth,
        maxDocuments: planConfig.maxDocuments,
        features: (planConfig.features as readonly string[]).includes('*')
          ? ['*']
          : [...planConfig.features],
      },
      include: { usage: true },
    });

    // Invalider le cache
    await this.invalidateCache(tenantId);

    return license;
  }

  /**
   * Vérifie si une feature est activée pour un tenant
   */
  async hasFeature(tenantId: string, feature: string): Promise<boolean> {
    const license = await this.getLicense(tenantId);

    // Licence non active = pas d'accès
    if (license.status !== 'ACTIVE') {
      return false;
    }

    // Licence expirée = pas d'accès
    if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
      return false;
    }

    // Wildcard = toutes les features
    if (license.features.includes('*')) {
      return true;
    }

    return license.features.includes(feature);
  }

  /**
   * Vérifie si un quota permet une action
   */
  async checkQuota(
    tenantId: string,
    quotaType: QuotaType,
    increment: number = 1
  ): Promise<QuotaCheckResult> {
    const license = await this.getLicense(tenantId);
    const usage = license.usage;

    const quotaMap: Record<QuotaType, { current: number; max: number }> = {
      users: {
        current: usage?.currentUsers ?? 0,
        max: license.maxUsers,
      },
      storage: {
        current: Number(usage?.currentStorage ?? 0),
        max: Number(license.maxStorage),
      },
      scans: {
        current: usage?.scansThisMonth ?? 0,
        max: license.maxScansMonth,
      },
      documents: {
        current: usage?.documentsCount ?? 0,
        max: license.maxDocuments,
      },
    };

    const { current, max } = quotaMap[quotaType];

    // -1 signifie illimité
    if (max === -1) {
      return {
        allowed: true,
        current,
        max,
        remaining: Infinity,
      };
    }

    const remaining = max - current;
    const allowed = current + increment <= max;

    return { allowed, current, max, remaining };
  }

  /**
   * Incrémente un compteur d'usage
   */
  async incrementUsage(
    tenantId: string,
    quotaType: QuotaType,
    amount: number = 1
  ): Promise<void> {
    const license = await this.getLicense(tenantId);

    if (!license.usage) {
      throw new Error(`No usage record for tenant ${tenantId}`);
    }

    const fieldMap: Record<QuotaType, string> = {
      users: 'currentUsers',
      storage: 'currentStorage',
      scans: 'scansThisMonth',
      documents: 'documentsCount',
    };

    await prisma.licenseUsage.update({
      where: { licenseId: license.id },
      data: {
        [fieldMap[quotaType]]: { increment: amount },
      },
    });

    // Invalider le cache
    await this.invalidateCache(tenantId);
  }

  /**
   * Décrémente un compteur d'usage
   */
  async decrementUsage(
    tenantId: string,
    quotaType: QuotaType,
    amount: number = 1
  ): Promise<void> {
    const license = await this.getLicense(tenantId);

    if (!license.usage) {
      throw new Error(`No usage record for tenant ${tenantId}`);
    }

    const fieldMap: Record<QuotaType, string> = {
      users: 'currentUsers',
      storage: 'currentStorage',
      scans: 'scansThisMonth',
      documents: 'documentsCount',
    };

    await prisma.licenseUsage.update({
      where: { licenseId: license.id },
      data: {
        [fieldMap[quotaType]]: { decrement: amount },
      },
    });

    // Invalider le cache
    await this.invalidateCache(tenantId);
  }

  /**
   * Vérifie la validité globale d'une licence
   */
  async isValid(tenantId: string): Promise<ValidityResult> {
    try {
      const license = await this.getLicense(tenantId);

      if (license.status === 'SUSPENDED') {
        return { valid: false, reason: 'License suspended' };
      }

      if (license.status === 'CANCELLED') {
        return { valid: false, reason: 'License cancelled' };
      }

      if (license.status === 'EXPIRED') {
        return { valid: false, reason: 'License expired' };
      }

      // Vérifier expiration
      if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
        // Mettre à jour le statut automatiquement
        await prisma.license.update({
          where: { id: license.id },
          data: { status: 'EXPIRED' },
        });
        await this.invalidateCache(tenantId);
        return { valid: false, reason: 'License expired' };
      }

      return { valid: true };
    } catch (error) {
      if (error instanceof LicenseNotFoundError) {
        return { valid: false, reason: 'No license found' };
      }
      throw error;
    }
  }

  /**
   * Suspend une licence
   */
  async suspend(tenantId: string): Promise<License> {
    const license = await prisma.license.update({
      where: { tenantId },
      data: { status: 'SUSPENDED' },
    });

    await this.invalidateCache(tenantId);
    return license;
  }

  /**
   * Réactive une licence
   */
  async reactivate(tenantId: string): Promise<License> {
    const license = await prisma.license.update({
      where: { tenantId },
      data: { status: 'ACTIVE' },
    });

    await this.invalidateCache(tenantId);
    return license;
  }

  /**
   * Reset mensuel des compteurs de scans
   */
  async resetMonthlyQuotas(): Promise<number> {
    const result = await prisma.licenseUsage.updateMany({
      data: {
        scansThisMonth: 0,
        lastResetAt: new Date(),
      },
    });

    // Invalider tout le cache licence
    try {
      const keys = await redis.keys(`${CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      console.warn('Failed to invalidate license cache:', err);
    }

    return result.count;
  }

  /**
   * Invalide le cache pour un tenant
   */
  private async invalidateCache(tenantId: string): Promise<void> {
    try {
      await redis.del(`${CACHE_PREFIX}${tenantId}`);
    } catch (err) {
      console.warn('Failed to invalidate license cache:', err);
    }
  }
}

// Export singleton
export const licenseService = new LicenseService();
