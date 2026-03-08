import { useQuery } from '@tanstack/react-query';
import { licenseApi } from '@/api/license.api';
import type { LicenseStatus } from '@/types/license';
import { isInternalDemoContext } from '@/lib/demoContext';

export const licenseQueryKey = ['license-status'] as const;

function normalizeFeature(feature: string): string {
  return feature.trim().toLowerCase();
}

const DEMO_LICENSE_SNAPSHOT: LicenseStatus = {
  status: 'valid',
  company: 'Stronghold Demo',
  plan: 'enterprise',
  licenseId: 'demo-bypass',
  features: [],
  maxNodes: null,
  maxUsers: null,
  maxCloudEnvs: null,
  issuedAt: null,
  expiresAt: null,
  daysUntilExpiry: null,
  gracePeriodDaysRemaining: null,
  isOperational: true,
};

function isDemoLicenseBypassEnabled(): boolean {
  return isInternalDemoContext();
}

export function useLicense() {
  const demoLicenseBypass = isDemoLicenseBypassEnabled();
  const query = useQuery({
    queryKey: licenseQueryKey,
    queryFn: async () => (await licenseApi.getLicenseStatus()).data,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
    enabled: !demoLicenseBypass,
  });

  const license: LicenseStatus | null = demoLicenseBypass
    ? DEMO_LICENSE_SNAPSHOT
    : query.data ?? null;
  const isOperational = demoLicenseBypass || Boolean(license?.isOperational);
  const plan = license?.plan ?? null;
  const needsActivation = demoLicenseBypass
    ? false
    : Boolean(
        license && !license.isOperational && (
          license.status === 'not_found' ||
          license.status === 'invalid_signature' ||
          license.status === 'fingerprint_mismatch' ||
          license.status === 'expired' ||
          license.status === 'error'
        ),
      );

  return {
    query,
    license,
    isLoading: demoLicenseBypass ? false : query.isLoading,
    isFetching: demoLicenseBypass ? false : query.isFetching,
    isOperational,
    plan,
    hasFeature: (feature: string) =>
      demoLicenseBypass ||
      Boolean(license?.features?.some((entry) => normalizeFeature(entry) === normalizeFeature(feature))),
    needsActivation,
    isExpired: license?.status === 'expired',
    isGracePeriod: license?.status === 'grace_period',
    daysUntilExpiry: license?.daysUntilExpiry ?? null,
  };
}
