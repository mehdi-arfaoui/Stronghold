import type { LicenseStatus } from '@/types/license';

type LicenseBannerProps = {
  license: LicenseStatus | null;
};

export function LicenseBanner({ license }: LicenseBannerProps) {
  if (!license) {
    return null;
  }

  if (license.status === 'grace_period') {
    return (
      <div className="border-b border-orange-300 bg-orange-100 px-4 py-3 text-sm text-orange-950">
        Votre licence a expire. Periode de grace : {license.gracePeriodDaysRemaining ?? 0} jour(s).
        Contactez support@stronghold.io.
      </div>
    );
  }

  if (typeof license.daysUntilExpiry === 'number' && license.daysUntilExpiry >= 0 && license.daysUntilExpiry < 30) {
    return (
      <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        Votre licence expire dans {license.daysUntilExpiry} jour(s).
      </div>
    );
  }

  return null;
}
