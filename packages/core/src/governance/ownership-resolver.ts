import type { Service } from '../services/service-types.js';
import type { GovernanceConfig } from './governance-types.js';

export function resolveOwnership(
  services: readonly Service[],
  governance: GovernanceConfig | null,
  asOf = new Date(),
): readonly Service[] {
  if (!governance) {
    return services.map((service) => ({ ...service }));
  }

  return services.map((service) => {
    const ownership = governance.ownership[service.id];
    if (!ownership) {
      return {
        ...service,
        owner: undefined,
        governance: {
          ownerStatus: 'none',
        },
      };
    }

    const nextReviewAt = ownership.confirmedAt
      ? addDays(ownership.confirmedAt, ownership.reviewCycleDays)
      : undefined;

    const ownerStatus =
      ownership.confirmed === true
        ? nextReviewAt && Date.parse(nextReviewAt) < asOf.getTime()
          ? 'review_due'
          : 'confirmed'
        : 'unconfirmed';

    return {
      ...service,
      owner: ownership.owner,
      governance: {
        owner: ownership.owner,
        ...(ownership.contact ? { contact: ownership.contact } : {}),
        ownerStatus,
        ...(ownership.confirmedAt ? { confirmedAt: ownership.confirmedAt } : {}),
        ...(nextReviewAt ? { nextReviewAt } : {}),
      },
    };
  });
}

function addDays(timestamp: string, days: number): string {
  const reference = new Date(timestamp);
  reference.setUTCDate(reference.getUTCDate() + days);
  return reference.toISOString();
}
