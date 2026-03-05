import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appLogger } from '../../utils/logger.js';

type PricingProvider = 'aws' | 'azure' | 'gcp';

type RegionPriceTable = Record<string, Record<string, number>>;

type PriceTable = {
  _meta: {
    lastUpdated: string;
    source: string;
    defaultRegion: string;
    currency: 'USD';
    assumptions: string;
  };
  regions: Record<string, RegionPriceTable>;
};

type StaticPriceMatchType = 'exact' | 'family-fallback';

export type StaticPriceLookup = {
  priceUSD: number;
  matchedRegion: string;
  matchType: StaticPriceMatchType;
  category: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cache = new Map<PricingProvider, PriceTable | null>();

function asProvider(provider: string): PricingProvider | null {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'aws' || normalized === 'azure' || normalized === 'gcp') {
    return normalized;
  }
  return null;
}

function readPriceTable(provider: PricingProvider): PriceTable | null {
  if (cache.has(provider)) {
    return cache.get(provider) ?? null;
  }

  const filePath = path.join(__dirname, `${provider}-prices.json`);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PriceTable;
    cache.set(provider, parsed);
    appLogger.info('pricing.static_catalog.loaded', {
      provider,
      filePath,
      lastUpdated: parsed?._meta?.lastUpdated || null,
      regionCount: Object.keys(parsed?.regions || {}).length,
    });
    return parsed;
  } catch (error) {
    cache.set(provider, null);
    appLogger.warn('pricing.static_catalog.load_failed', {
      provider,
      filePath,
      error: error instanceof Error ? error.message : 'unknown_error',
    });
    return null;
  }
}

function normalizeRegion(region: string | undefined): string | undefined {
  if (!region) return undefined;
  const normalized = region.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized.replace(/-[a-z]$/, '');
}

function getRegionsToTry(prices: PriceTable, region?: string): string[] {
  const keys = Object.keys(prices.regions || {});
  const defaultRegion = normalizeRegion(prices._meta?.defaultRegion) || keys[0];
  const normalizedRegion = normalizeRegion(region);
  const ordered = [normalizedRegion, defaultRegion, ...keys].filter(
    (value): value is string => Boolean(value),
  );
  return Array.from(new Set(ordered));
}

function collectCategories(prices: PriceTable, region: string): Array<[string, Record<string, number>]> {
  const regionTable = prices.regions?.[region];
  if (!regionTable || typeof regionTable !== 'object') return [];
  return Object.entries(regionTable).filter((entry): entry is [string, Record<string, number>] => {
    const [, value] = entry;
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  });
}

function normalizeInstanceType(raw: string): string {
  const value = raw.trim();
  if (value.includes('/')) {
    const segments = value.split('/');
    return segments[segments.length - 1] || value;
  }
  return value;
}

function lookupExact(category: Record<string, number>, instanceType: string): number | null {
  if (typeof category[instanceType] === 'number') {
    return category[instanceType] as number;
  }

  const normalized = instanceType.toLowerCase();
  const found = Object.entries(category).find(([key]) => key.toLowerCase() === normalized);
  return found ? found[1] : null;
}

function familyPrefix(instanceType: string): string | null {
  if (instanceType.includes('.')) {
    return instanceType.replace(/\.[^.]+$/, '');
  }
  if (instanceType.includes('-')) {
    return instanceType.replace(/-\d+x?large$/i, '').replace(/-(small|medium|large|xlarge)$/i, '');
  }
  if (instanceType.includes('_')) {
    return instanceType.replace(/_[^_]+$/, '');
  }
  return null;
}

export function sizeMultiplier(instanceType: string): number {
  const normalized = instanceType.toLowerCase();
  if (normalized.includes('nano')) return 0.25;
  if (normalized.includes('micro')) return 0.5;
  if (normalized.includes('small')) return 1;
  if (normalized.includes('medium')) return 2;
  if (normalized.includes('24xlarge')) return 96;
  if (normalized.includes('16xlarge')) return 64;
  if (normalized.includes('12xlarge')) return 48;
  if (normalized.includes('8xlarge')) return 32;
  if (normalized.includes('4xlarge')) return 16;
  if (normalized.includes('2xlarge')) return 8;
  if (normalized.includes('xlarge')) return 4;
  if (normalized.includes('large')) return 2;
  return 2;
}

function lookupByFamily(
  category: Record<string, number>,
  instanceType: string,
): { referenceType: string; estimatedPrice: number } | null {
  const family = familyPrefix(instanceType);
  if (!family) return null;

  for (const [referenceType, referencePrice] of Object.entries(category)) {
    if (!referenceType.startsWith(family)) continue;
    if (!referenceType.includes('large') && !referenceType.includes('medium') && !referenceType.includes('small')) {
      continue;
    }

    const refSize = sizeMultiplier(referenceType);
    const targetSize = sizeMultiplier(instanceType);
    if (refSize <= 0 || targetSize <= 0) continue;
    return {
      referenceType,
      estimatedPrice: Number((referencePrice * (targetSize / refSize)).toFixed(4)),
    };
  }

  return null;
}

export function loadPrices(provider: string): PriceTable | null {
  const providerKey = asProvider(provider);
  if (!providerKey) return null;
  return readPriceTable(providerKey);
}

export function lookupStaticPrice(
  provider: string,
  instanceType: string | undefined,
  region?: string,
): StaticPriceLookup | null {
  const providerKey = asProvider(provider);
  if (!providerKey || !instanceType) return null;

  const prices = readPriceTable(providerKey);
  if (!prices?.regions) return null;

  const normalizedInstanceType = normalizeInstanceType(instanceType);
  if (!normalizedInstanceType) return null;

  const regions = getRegionsToTry(prices, region);

  for (const tryRegion of regions) {
    const categories = collectCategories(prices, tryRegion);
    for (const [categoryName, category] of categories) {
      const exact = lookupExact(category, normalizedInstanceType);
      if (exact != null && exact > 0) {
        return {
          priceUSD: exact,
          matchedRegion: tryRegion,
          matchType: 'exact',
          category: categoryName,
        };
      }
    }
  }

  for (const tryRegion of regions) {
    const categories = collectCategories(prices, tryRegion);
    for (const [categoryName, category] of categories) {
      const family = lookupByFamily(category, normalizedInstanceType);
      if (!family || family.estimatedPrice <= 0) continue;
      appLogger.debug('pricing.static_catalog.family_fallback', {
        provider: providerKey,
        instanceType: normalizedInstanceType,
        region: tryRegion,
        category: categoryName,
        referenceType: family.referenceType,
      });
      return {
        priceUSD: family.estimatedPrice,
        matchedRegion: tryRegion,
        matchType: 'family-fallback',
        category: categoryName,
      };
    }
  }

  return null;
}
