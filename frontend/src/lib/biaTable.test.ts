import { describe, expect, it } from 'vitest';
import { DEFAULT_BIA_FILTERS, filterAndSortBiaEntries } from '@/lib/biaTable';
import type { BIAEntry } from '@/types/bia.types';

function createEntry(overrides: Partial<BIAEntry>): BIAEntry {
  return {
    id: overrides.id || 'bia-1',
    nodeId: overrides.nodeId || overrides.id || 'node-1',
    serviceName: overrides.serviceName || 'service',
    serviceType: overrides.serviceType || 'DATABASE',
    tier: overrides.tier ?? 3,
    rto: overrides.rto ?? 60,
    rpo: overrides.rpo ?? 15,
    mtpd: overrides.mtpd ?? 180,
    rtoSuggested: overrides.rtoSuggested ?? 60,
    rpoSuggested: overrides.rpoSuggested ?? 15,
    mtpdSuggested: overrides.mtpdSuggested ?? 180,
    validated: overrides.validated ?? false,
    downtimeCostPerHour: overrides.downtimeCostPerHour ?? 0,
    dependencies: overrides.dependencies ?? [],
    blastRadius: overrides.blastRadius ?? {
      directDependents: 0,
      transitiveDependents: 0,
      totalServices: 1,
      impactedServices: [],
    },
    ...overrides,
  };
}

describe('filterAndSortBiaEntries', () => {
  it('sorts by tier ascending and blast radius descending by default', () => {
    const entries = [
      createEntry({ id: '3', serviceName: 'Billing', tier: 2, blastRadius: { directDependents: 0, transitiveDependents: 6, totalServices: 8, impactedServices: [] } }),
      createEntry({ id: '1', serviceName: 'Auth', tier: 1, blastRadius: { directDependents: 0, transitiveDependents: 2, totalServices: 8, impactedServices: [] } }),
      createEntry({ id: '2', serviceName: 'Catalog', tier: 1, blastRadius: { directDependents: 0, transitiveDependents: 5, totalServices: 8, impactedServices: [] } }),
    ];

    const result = filterAndSortBiaEntries(entries, DEFAULT_BIA_FILTERS);

    expect(result.map((entry) => entry.id)).toEqual(['2', '1', '3']);
  });

  it('filters on tier, blast radius and hourly cost', () => {
    const entries = [
      createEntry({ id: '1', tier: 1, downtimeCostPerHour: 800, blastRadius: { directDependents: 0, transitiveDependents: 2, totalServices: 4, impactedServices: [] } }),
      createEntry({ id: '2', tier: 2, downtimeCostPerHour: 1500, blastRadius: { directDependents: 0, transitiveDependents: 7, totalServices: 9, impactedServices: [] } }),
      createEntry({ id: '3', tier: 3, downtimeCostPerHour: 2200, blastRadius: { directDependents: 0, transitiveDependents: 8, totalServices: 9, impactedServices: [] } }),
    ];

    const result = filterAndSortBiaEntries(entries, {
      ...DEFAULT_BIA_FILTERS,
      tiers: [2, 3],
      blastRadiusValue: 7,
      hourlyCostValue: 2000,
      sortBy: 'hourlyCost',
      sortOrder: 'desc',
    });

    expect(result.map((entry) => entry.id)).toEqual(['3']);
  });
});
