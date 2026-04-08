import type { ApiGovernanceOwnershipSummary, RiskAcceptance } from '@stronghold-dr/core';

export type DisplayOwnerStatus = ApiGovernanceOwnershipSummary['ownerStatus'];

export interface OwnerPresentation {
  readonly owner: string | null;
  readonly status: DisplayOwnerStatus;
  readonly confirmedAt: string | null;
  readonly nextReviewAt: string | null;
  readonly contact: string | null;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function resolveOwnerPresentation(service: {
  readonly owner?: string;
  readonly governance?: {
    readonly owner?: string;
    readonly contact?: string;
    readonly ownerStatus: Exclude<DisplayOwnerStatus, 'declared'>;
    readonly confirmedAt?: string;
    readonly nextReviewAt?: string;
  };
}): OwnerPresentation {
  const owner = service.governance?.owner ?? service.owner ?? null;
  if (service.governance) {
    return {
      owner,
      status: service.governance.ownerStatus,
      confirmedAt: service.governance.confirmedAt ?? null,
      nextReviewAt: service.governance.nextReviewAt ?? null,
      contact: service.governance.contact ?? null,
    };
  }

  return {
    owner,
    status: owner ? 'declared' : 'none',
    confirmedAt: null,
    nextReviewAt: null,
    contact: null,
  };
}

export function ownerStatusLabel(status: DisplayOwnerStatus): string {
  switch (status) {
    case 'confirmed':
      return 'confirmed';
    case 'unconfirmed':
      return 'unconfirmed';
    case 'review_due':
      return 'review due';
    case 'declared':
      return 'declared';
    default:
      return 'not assigned';
  }
}

export function ownerStatusTone(status: DisplayOwnerStatus): string {
  switch (status) {
    case 'confirmed':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
    case 'review_due':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
    case 'unconfirmed':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-100';
    case 'declared':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-100';
    default:
      return 'border-border bg-card/70 text-muted-foreground';
  }
}

export function formatOwnerName(presentation: OwnerPresentation): string {
  return presentation.owner ?? 'Not assigned';
}

export function describeOwnerPresentation(presentation: OwnerPresentation): string {
  switch (presentation.status) {
    case 'confirmed':
      return [
        presentation.confirmedAt ? `Confirmed ${formatShortDate(presentation.confirmedAt)}.` : null,
        presentation.nextReviewAt ? `Next review ${formatShortDate(presentation.nextReviewAt)}.` : null,
      ]
        .filter(Boolean)
        .join(' ');
    case 'review_due':
      return [
        presentation.confirmedAt ? `Last confirmed ${formatShortDate(presentation.confirmedAt)}.` : null,
        presentation.nextReviewAt ? `Review was due ${formatShortDate(presentation.nextReviewAt)}.` : null,
      ]
        .filter(Boolean)
        .join(' ');
    case 'unconfirmed':
      return 'Owner is recorded in governance but has not confirmed responsibility yet.';
    case 'declared':
      return 'Owner is declared on the service definition. No governance confirmation is recorded yet.';
    default:
      return 'No owner is assigned to this service.';
  }
}

export function acceptanceTone(status: RiskAcceptance['status']): string {
  switch (status) {
    case 'active':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
    case 'superseded':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
    default:
      return 'border-red-500/30 bg-red-500/10 text-red-100';
  }
}

export function acceptanceLabel(status: RiskAcceptance['status']): string {
  switch (status) {
    case 'active':
      return 'accepted';
    case 'superseded':
      return 'superseded';
    default:
      return 'expired';
  }
}

export function describeAcceptanceWindow(
  acceptance: Pick<RiskAcceptance, 'expiresAt' | 'status'>,
  reference = new Date(),
): string {
  const delta = formatDayDistance(acceptance.expiresAt, reference);
  if (acceptance.status === 'active') {
    return `Expires ${formatShortDate(acceptance.expiresAt)} (${delta})`;
  }
  return `Expired ${formatShortDate(acceptance.expiresAt)} (${delta})`;
}

export function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

export function formatDayDistance(value: string, reference = new Date()): string {
  const target = new Date(value);
  const referenceUtc = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  );
  const targetUtc = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
  const distance = Math.round((targetUtc - referenceUtc) / DAY_IN_MS);
  if (distance === 0) {
    return 'today';
  }

  const absoluteDistance = Math.abs(distance);
  const suffix = absoluteDistance === 1 ? 'day' : 'days';
  return distance > 0
    ? `${absoluteDistance} ${suffix} remaining`
    : `${absoluteDistance} ${suffix} ago`;
}
