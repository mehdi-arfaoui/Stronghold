import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import { compactVerify, importSPKI } from 'jose';
import prisma from '../prismaClient.js';
import { appLogger } from '../utils/logger.js';
import {
  LEGACY_FEATURE_ALIASES,
  type LicenseFeature,
  type LicensePlan,
} from '../config/licensePlans.js';
import type { LicenseApiSnapshot, LicensePayload, LicenseStatus } from '../types/license.js';

const LICENSE_REVALIDATION_MS = 6 * 60 * 60 * 1000;
const GRACE_PERIOD_DAYS = 15;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const LICENSE_SIGNATURE_ALGORITHM = 'EdDSA';
const textDecoder = new TextDecoder();

type LicenseBindingRecord = {
  id: string;
  licenseId: string;
  fingerprint: string;
  boundAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type LicenseBindingPrisma = {
  licenseBinding: {
    findUnique(args: { where: { licenseId: string } }): Promise<LicenseBindingRecord | null>;
    create(args: { data: { licenseId: string; fingerprint: string } }): Promise<LicenseBindingRecord>;
  };
};

function isLicensePlan(value: unknown): value is LicensePlan {
  return value === 'starter' || value === 'pro' || value === 'enterprise';
}

function normalizeFeature(feature: string): string {
  return feature.trim().toLowerCase();
}

function normalizePayload(payload: unknown): LicensePayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const lid = typeof candidate.lid === 'string' ? candidate.lid.trim() : '';
  const company = typeof candidate.company === 'string' ? candidate.company.trim() : '';
  const plan = typeof candidate.plan === 'string' ? candidate.plan.trim().toLowerCase() : '';
  const maxNodes = Number(candidate.maxNodes);
  const maxUsers = Number(candidate.maxUsers);
  const maxCloudEnvs = Number(candidate.maxCloudEnvs);
  const iat = Number(candidate.iat);
  const exp = Number(candidate.exp);
  const rawFeatures = Array.isArray(candidate.features) ? candidate.features : [];
  const features = rawFeatures
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => normalizeFeature(entry)) as LicenseFeature[];

  if (
    !lid ||
    !company ||
    !isLicensePlan(plan) ||
    !Number.isFinite(maxNodes) ||
    !Number.isFinite(maxUsers) ||
    !Number.isFinite(maxCloudEnvs) ||
    !Number.isFinite(iat) ||
    !Number.isFinite(exp)
  ) {
    return null;
  }

  return {
    lid,
    company,
    plan,
    maxNodes,
    maxUsers,
    maxCloudEnvs,
    features,
    iat: Math.trunc(iat),
    exp: Math.trunc(exp),
  };
}

export class LicenseService {
  private readonly licensePath: string;
  private readonly publicKeyPath: string;
  private readonly prismaClient: LicenseBindingPrisma;
  private publicKey: Awaited<ReturnType<typeof importSPKI>> | null = null;
  private license: LicensePayload | null = null;
  private status: LicenseStatus = 'not_found';
  private revalidationTimer: NodeJS.Timeout | null = null;

  constructor(prismaClient: LicenseBindingPrisma) {
    this.prismaClient = prismaClient;
    this.licensePath = process.env.LICENSE_PATH || '/app/license/stronghold.lic';
    this.publicKeyPath = process.env.LICENSE_PUBLIC_KEY_PATH || '/app/license/license-public.pem';
  }

  async initialize(): Promise<void> {
    try {
      await this.loadPublicKey();
    } catch (error) {
      this.status = 'error';
      appLogger.error('Failed to load license public key', {
        path: this.publicKeyPath,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }

    await this.validate();

    if (this.revalidationTimer) {
      clearInterval(this.revalidationTimer);
    }

    this.revalidationTimer = setInterval(() => {
      void this.validate().catch((error) => {
        appLogger.error('License revalidation failed', {
          message: error instanceof Error ? error.message : 'unknown error',
        });
      });
    }, LICENSE_REVALIDATION_MS);
    this.revalidationTimer.unref?.();
  }

  async validate(): Promise<LicenseStatus> {
    try {
      if (!fs.existsSync(this.licensePath)) {
        this.license = null;
        this.status = 'not_found';
        return this.status;
      }

      const token = (await fsp.readFile(this.licensePath, 'utf-8')).trim();
      if (!token) {
        this.license = null;
        this.status = 'not_found';
        return this.status;
      }

      if (!this.publicKey) {
        await this.loadPublicKey();
      }

      let verified: unknown;
      try {
        const { protectedHeader, payload } = await compactVerify(token, this.publicKey as Awaited<ReturnType<typeof importSPKI>>);
        if (protectedHeader.alg !== LICENSE_SIGNATURE_ALGORITHM) {
          this.license = null;
          this.status = 'invalid_signature';
          return this.status;
        }
        verified = JSON.parse(textDecoder.decode(payload));
      } catch (error) {
        this.license = null;
        this.status = 'invalid_signature';
        return this.status;
      }

      const payload = normalizePayload(verified);
      if (!payload) {
        this.license = null;
        this.status = 'error';
        return this.status;
      }

      this.license = payload;

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp < nowSeconds) {
        const expiredDays = Math.floor((Date.now() - payload.exp * 1000) / DAY_IN_MS);
        this.status = expiredDays <= GRACE_PERIOD_DAYS ? 'grace_period' : 'expired';
        if (this.status === 'expired') {
          return this.status;
        }
      }

      const fingerprintMatches = await this.verifyFingerprint(payload.lid);
      if (!fingerprintMatches) {
        this.status = 'fingerprint_mismatch';
        return this.status;
      }

      if (payload.exp < nowSeconds) {
        this.status = 'grace_period';
        return this.status;
      }

      this.status = 'valid';
      return this.status;
    } catch (error) {
      this.license = null;
      this.status = 'error';
      appLogger.error('License validation failed', {
        message: error instanceof Error ? error.message : 'unknown error',
      });
      return this.status;
    }
  }

  async activate(token: string): Promise<LicenseStatus> {
    await fsp.mkdir(path.dirname(this.licensePath), { recursive: true });
    await fsp.writeFile(this.licensePath, token.trim(), 'utf-8');
    return this.validate();
  }

  async verifyFingerprint(licenseId: string): Promise<boolean> {
    const fingerprint = await this.generateFingerprint();
    const existing = await this.prismaClient.licenseBinding.findUnique({
      where: { licenseId },
    });

    if (!existing) {
      try {
        await this.prismaClient.licenseBinding.create({
          data: {
            licenseId,
            fingerprint,
          },
        });
        return true;
      } catch {
        const reloaded = await this.prismaClient.licenseBinding.findUnique({
          where: { licenseId },
        });
        return reloaded?.fingerprint === fingerprint;
      }
    }

    return existing.fingerprint === fingerprint;
  }

  shutdown(): void {
    if (this.revalidationTimer) {
      clearInterval(this.revalidationTimer);
      this.revalidationTimer = null;
    }
  }

  getLicense(): LicensePayload | null {
    return this.license;
  }

  getStatus(): LicenseStatus {
    return this.status;
  }

  isOperational(): boolean {
    return this.status === 'valid' || this.status === 'grace_period';
  }

  hasFeature(feature: string): boolean {
    const normalized = normalizeFeature(feature);
    const mappedFeature = LEGACY_FEATURE_ALIASES[normalized] || normalized;
    return this.license?.features.includes(mappedFeature as LicenseFeature) ?? false;
  }

  getMaxNodes(): number {
    return this.license?.maxNodes ?? 0;
  }

  getMaxUsers(): number {
    return this.license?.maxUsers ?? 0;
  }

  getMaxCloudEnvs(): number {
    return this.license?.maxCloudEnvs ?? 0;
  }

  getDaysUntilExpiry(): number | null {
    if (!this.license) {
      return null;
    }

    const diffMs = this.license.exp * 1000 - Date.now();
    return Math.ceil(diffMs / DAY_IN_MS);
  }

  getGracePeriodDaysRemaining(): number | null {
    if (!this.license || this.status !== 'grace_period') {
      return null;
    }

    const expiredDays = Math.max(0, Math.floor((Date.now() - this.license.exp * 1000) / DAY_IN_MS));
    return Math.max(0, GRACE_PERIOD_DAYS - expiredDays);
  }

  getPlan(): LicensePlan | null {
    return this.license?.plan ?? null;
  }

  getLicensePath(): string {
    return this.licensePath;
  }

  toJSON(): LicenseApiSnapshot {
    return {
      status: this.status,
      company: this.license?.company ?? null,
      plan: this.license?.plan ?? null,
      licenseId: this.license?.lid ?? null,
      features: this.license?.features ?? [],
      maxNodes: this.license?.maxNodes ?? null,
      maxUsers: this.license?.maxUsers ?? null,
      maxCloudEnvs: this.license?.maxCloudEnvs ?? null,
      issuedAt: this.license ? new Date(this.license.iat * 1000).toISOString() : null,
      expiresAt: this.license ? new Date(this.license.exp * 1000).toISOString() : null,
      daysUntilExpiry: this.getDaysUntilExpiry(),
      gracePeriodDaysRemaining: this.getGracePeriodDaysRemaining(),
      isOperational: this.isOperational(),
    };
  }

  async resetMonthlyQuotas(): Promise<number> {
    return 0;
  }

  private async loadPublicKey(): Promise<void> {
    const pem = await fsp.readFile(this.publicKeyPath, 'utf-8');
    this.publicKey = await importSPKI(pem, LICENSE_SIGNATURE_ALGORITHM);
  }

  private async generateFingerprint(): Promise<string> {
    const machineIdentity = await this.resolveMachineIdentity();
    const cpuCount = os.cpus().length;
    const totalMemory = os.totalmem();
    return crypto
      .createHash('sha256')
      .update(`${machineIdentity}:${cpuCount}:${totalMemory}`, 'utf-8')
      .digest('hex');
  }

  private async resolveMachineIdentity(): Promise<string> {
    try {
      const machineId = await fsp.readFile('/etc/machine-id', 'utf-8');
      const normalized = machineId.trim();
      if (normalized) {
        return normalized;
      }
    } catch {
      // Fall back to hostname outside Linux/Docker environments.
    }

    return os.hostname();
  }
}

export const licenseService = new LicenseService(prisma as unknown as PrismaClient);
