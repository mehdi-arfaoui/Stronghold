import type { Evidence } from './evidence-types.js';

export interface FreshnessResult {
  readonly status: 'fresh' | 'expiring_soon' | 'expired';
  readonly daysUntilExpiry: number | null;
  readonly message: string;
}

export const DEFAULT_EVIDENCE_EXPIRATION_DAYS: Readonly<Record<'declared' | 'tested', number>> = {
  declared: 180,
  tested: 90,
};

export function checkFreshness(
  evidence: Evidence,
  asOf: Date = new Date(),
): FreshnessResult {
  const effectiveExpiresAt = resolveEvidenceExpiresAt(evidence);

  if (evidence.type === 'expired') {
    return {
      status: 'expired',
      daysUntilExpiry: effectiveExpiresAt ? differenceInDays(effectiveExpiresAt, asOf) : null,
      message: effectiveExpiresAt
        ? `Evidence expired on ${effectiveExpiresAt.toISOString().slice(0, 10)}.`
        : 'Evidence has expired.',
    };
  }

  if (!effectiveExpiresAt) {
    return {
      status: 'fresh',
      daysUntilExpiry: null,
      message: 'Evidence has no automatic expiration.',
    };
  }

  const daysUntilExpiry = differenceInDays(effectiveExpiresAt, asOf);
  if (daysUntilExpiry < 0) {
    return {
      status: 'expired',
      daysUntilExpiry,
      message: `Evidence expired on ${effectiveExpiresAt.toISOString().slice(0, 10)}.`,
    };
  }
  if (daysUntilExpiry <= 14) {
    return {
      status: 'expiring_soon',
      daysUntilExpiry,
      message: `Evidence expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}.`,
    };
  }

  return {
    status: 'fresh',
    daysUntilExpiry,
    message: `Evidence is fresh for ${daysUntilExpiry} more day${daysUntilExpiry === 1 ? '' : 's'}.`,
  };
}

export function resolveEvidenceExpiresAt(evidence: Evidence): Date | null {
  const explicitExpiry = parseDate(evidence.expiresAt);
  if (explicitExpiry) {
    return explicitExpiry;
  }

  if (evidence.type === 'declared') {
    return addDays(parseDate(evidence.timestamp), DEFAULT_EVIDENCE_EXPIRATION_DAYS.declared);
  }
  if (evidence.type === 'tested') {
    return addDays(parseDate(evidence.timestamp), DEFAULT_EVIDENCE_EXPIRATION_DAYS.tested);
  }

  return null;
}

export function applyEvidenceFreshness(
  evidence: Evidence,
  asOf: Date = new Date(),
): Evidence {
  const effectiveExpiresAt = resolveEvidenceExpiresAt(evidence);
  const freshness = checkFreshness(
    effectiveExpiresAt
      ? {
          ...evidence,
          expiresAt: effectiveExpiresAt.toISOString(),
        }
      : evidence,
    asOf,
  );

  return {
    ...evidence,
    ...(effectiveExpiresAt ? { expiresAt: effectiveExpiresAt.toISOString() } : {}),
    ...(freshness.status === 'expired' ? { type: 'expired' as const } : {}),
  };
}

function parseDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function addDays(value: Date | null, days: number): Date | null {
  if (!value) {
    return null;
  }
  return new Date(value.getTime() + days * 86_400_000);
}

function differenceInDays(target: Date, asOf: Date): number {
  return Math.ceil((target.getTime() - asOf.getTime()) / 86_400_000);
}
