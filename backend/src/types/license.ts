import type { LicenseFeature, LicensePlan } from '../config/licensePlans.js';

export interface LicensePayload {
  lid: string;
  company: string;
  plan: LicensePlan;
  maxNodes: number;
  maxUsers: number;
  maxCloudEnvs: number;
  features: LicenseFeature[];
  iat: number;
  exp: number;
}

export type LicenseStatus =
  | 'valid'
  | 'expired'
  | 'grace_period'
  | 'invalid_signature'
  | 'fingerprint_mismatch'
  | 'not_found'
  | 'error';

export interface LicenseApiSnapshot {
  status: LicenseStatus;
  company: string | null;
  plan: LicensePlan | null;
  licenseId: string | null;
  features: LicenseFeature[];
  maxNodes: number | null;
  maxUsers: number | null;
  maxCloudEnvs: number | null;
  issuedAt: string | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  gracePeriodDaysRemaining: number | null;
  isOperational: boolean;
}
