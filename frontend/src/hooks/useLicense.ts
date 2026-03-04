import { useQuery } from '@tanstack/react-query';
import { licenseApi } from '@/api/license.api';
import type { LicenseStatus } from '@/types/license';

export const licenseQueryKey = ['license-status'] as const;

function normalizeFeature(feature: string): string {
  return feature.trim().toLowerCase();
}

export function useLicense() {
  const query = useQuery({
    queryKey: licenseQueryKey,
    queryFn: async () => (await licenseApi.getLicenseStatus()).data,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  const license: LicenseStatus | null = query.data ?? null;
  const isOperational = Boolean(license?.isOperational);
  const plan = license?.plan ?? null;
  const needsActivation = Boolean(
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
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isOperational,
    plan,
    hasFeature: (feature: string) =>
      Boolean(license?.features?.some((entry) => normalizeFeature(entry) === normalizeFeature(feature))),
    needsActivation,
    isExpired: license?.status === 'expired',
    isGracePeriod: license?.status === 'grace_period',
    daysUntilExpiry: license?.daysUntilExpiry ?? null,
  };
}
