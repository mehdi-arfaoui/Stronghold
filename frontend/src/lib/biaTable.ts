import type { BIAEntry } from '@/types/bia.types';

export type BIASortKey =
  | 'serviceName'
  | 'serviceType'
  | 'tier'
  | 'rto'
  | 'rpo'
  | 'mtpd'
  | 'blastRadius'
  | 'hourlyCost'
  | 'source'
  | 'validated';

export interface BIAFilters {
  tiers: number[];
  blastRadiusOp: '>=' | '<=';
  blastRadiusValue: number | null;
  hourlyCostOp: '>=' | '<=';
  hourlyCostValue: number | null;
  sortBy: BIASortKey;
  sortOrder: 'asc' | 'desc';
}

export const DEFAULT_BIA_FILTERS: BIAFilters = {
  tiers: [1, 2, 3, 4],
  blastRadiusOp: '>=',
  blastRadiusValue: null,
  hourlyCostOp: '>=',
  hourlyCostValue: null,
  sortBy: 'tier',
  sortOrder: 'asc',
};

export function getBiaHourlyCost(entry: BIAEntry): number {
  const value = entry.downtimeCostPerHour ?? entry.financialImpactPerHour ?? 0;
  return Number.isFinite(value) ? Number(value) : 0;
}

export function getBiaBlastRadiusValue(entry: BIAEntry): number {
  const transitive = Number(entry.blastRadius?.transitiveDependents ?? 0);
  return Number.isFinite(transitive) ? transitive : 0;
}

function compareNullableNumber(left: number | null | undefined, right: number | null | undefined): number {
  const leftMissing = left == null || !Number.isFinite(left);
  const rightMissing = right == null || !Number.isFinite(right);
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return Number(left) - Number(right);
}

function compareString(left: string | null | undefined, right: string | null | undefined): number {
  return String(left || '').localeCompare(String(right || ''), 'fr', { sensitivity: 'base' });
}

function compareValues(a: BIAEntry, b: BIAEntry, sortBy: BIASortKey, sortOrder: 'asc' | 'desc'): number {
  const direction = sortOrder === 'asc' ? 1 : -1;

  switch (sortBy) {
    case 'serviceName':
      return compareString(a.serviceName, b.serviceName) * direction;
    case 'serviceType':
      return compareString(a.serviceTypeLabel ?? a.serviceType, b.serviceTypeLabel ?? b.serviceType) * direction;
    case 'tier':
      return compareNullableNumber(a.tier, b.tier) * direction;
    case 'rto':
      return compareNullableNumber(a.rto, b.rto) * direction;
    case 'rpo':
      return compareNullableNumber(a.rpo, b.rpo) * direction;
    case 'mtpd':
      return compareNullableNumber(a.mtpd, b.mtpd) * direction;
    case 'blastRadius':
      return compareNullableNumber(getBiaBlastRadiusValue(a), getBiaBlastRadiusValue(b)) * direction;
    case 'hourlyCost':
      return compareNullableNumber(getBiaHourlyCost(a), getBiaHourlyCost(b)) * direction;
    case 'source':
      return compareString(
        a.downtimeCostSourceLabel ?? a.financialScopeLabel ?? '',
        b.downtimeCostSourceLabel ?? b.financialScopeLabel ?? '',
      ) * direction;
    case 'validated':
      return compareNullableNumber(a.validated ? 1 : 0, b.validated ? 1 : 0) * direction;
    default:
      return 0;
  }
}

export function filterAndSortBiaEntries(entries: BIAEntry[], filters: BIAFilters): BIAEntry[] {
  return [...entries]
    .filter((entry) => filters.tiers.includes(entry.tier))
    .filter((entry) => {
      if (filters.blastRadiusValue == null) return true;
      const blastRadius = getBiaBlastRadiusValue(entry);
      return filters.blastRadiusOp === '>='
        ? blastRadius >= filters.blastRadiusValue
        : blastRadius <= filters.blastRadiusValue;
    })
    .filter((entry) => {
      if (filters.hourlyCostValue == null) return true;
      const hourlyCost = getBiaHourlyCost(entry);
      return filters.hourlyCostOp === '>='
        ? hourlyCost >= filters.hourlyCostValue
        : hourlyCost <= filters.hourlyCostValue;
    })
    .sort((a, b) => {
      const primary = compareValues(a, b, filters.sortBy, filters.sortOrder);
      if (primary !== 0) return primary;

      if (filters.sortBy !== 'tier') {
        const tierFallback = compareValues(a, b, 'tier', 'asc');
        if (tierFallback !== 0) return tierFallback;
      }

      if (filters.sortBy !== 'blastRadius') {
        const blastFallback = compareValues(a, b, 'blastRadius', 'desc');
        if (blastFallback !== 0) return blastFallback;
      }

      if (filters.sortBy !== 'hourlyCost') {
        const costFallback = compareValues(a, b, 'hourlyCost', 'desc');
        if (costFallback !== 0) return costFallback;
      }

      return compareString(a.serviceName, b.serviceName);
    });
}
