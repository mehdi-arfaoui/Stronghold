import type { License, LicenseUsage, PlanType, LicenseStatus } from '@prisma/client';

export type LicenseWithUsage = License & {
  usage: LicenseUsage | null;
};

export type QuotaType = 'users' | 'storage' | 'scans' | 'documents';

export interface QuotaCheckResult {
  allowed: boolean;
  current: number;
  max: number;
  remaining: number;
}

export interface QuotaInfo {
  current: number;
  max: number;
  percentage: number;
  remaining: number;
}

export interface LicenseUsageResponse {
  plan: {
    name: string;
    type: PlanType;
  };
  status: LicenseStatus;
  expiresAt: Date | null;
  quotas: {
    users: QuotaInfo;
    storage: QuotaInfo & { currentFormatted: string; maxFormatted: string };
    scans: QuotaInfo & { resetsAt: Date };
    documents: QuotaInfo;
  };
  features: {
    available: string[];
    all: string[];
  };
}

export interface ValidityResult {
  valid: boolean;
  reason?: string;
}
