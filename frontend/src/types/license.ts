export type LicenseValidationStatus =
  | 'valid'
  | 'expired'
  | 'grace_period'
  | 'invalid_signature'
  | 'fingerprint_mismatch'
  | 'not_found'
  | 'error';

export type LicensePlan = 'starter' | 'pro' | 'enterprise';

export interface LicenseStatus {
  status: LicenseValidationStatus;
  company: string | null;
  plan: LicensePlan | null;
  licenseId: string | null;
  features: string[];
  maxNodes: number | null;
  maxUsers: number | null;
  maxCloudEnvs: number | null;
  issuedAt: string | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  gracePeriodDaysRemaining: number | null;
  isOperational: boolean;
}

export interface LicenseActivationResponse extends LicenseStatus {
  success: boolean;
  message?: string;
}
