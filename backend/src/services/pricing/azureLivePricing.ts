import { fetchAzureRetailPrices } from '../azurePricingService.js';

const HOURS_PER_MONTH = 730;

function escapeFilterValue(value: string): string {
  return value.replace(/'/g, "''");
}

function toPlainItems(items: unknown[]): Array<Record<string, unknown>> {
  return items
    .filter((item): item is Record<string, unknown> => {
      return Boolean(item && typeof item === 'object' && !Array.isArray(item));
    });
}

function monthlyFromRetailPrice(item: Record<string, unknown>): number | null {
  const retailPrice = Number(item.retailPrice);
  if (!Number.isFinite(retailPrice) || retailPrice < 0) return null;
  const unitOfMeasure = String(item.unitOfMeasure || item.unit || '').toLowerCase();

  if (unitOfMeasure.includes('hour')) {
    return Number((retailPrice * HOURS_PER_MONTH).toFixed(4));
  }
  if (unitOfMeasure.includes('month')) {
    return Number(retailPrice.toFixed(4));
  }

  // Azure prices API can expose "1 GB/Month", "10,000 Transactions", etc.
  // For unknown unit shapes we return monthly-as-is to avoid dropping a valid
  // consumption price that was already monthly.
  return Number(retailPrice.toFixed(4));
}

function findFirstMonthlyPrice(
  items: Array<Record<string, unknown>>,
  predicate: (item: Record<string, unknown>) => boolean,
): number | null {
  const selected = items.find(predicate);
  if (!selected) return null;
  return monthlyFromRetailPrice(selected);
}

async function fetchAzurePrices(filter: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetchAzureRetailPrices({
    filter,
    pageSize: 100,
    maxPages: 3,
  });
  return toPlainItems(response.items);
}

function isConsumption(item: Record<string, unknown>): boolean {
  const priceType = String(item.priceType || item.type || '').toLowerCase();
  if (priceType.length === 0) return true;
  return priceType.includes('consumption');
}

function isNotWindowsOrSpot(item: Record<string, unknown>): boolean {
  const text = `${String(item.productName || '')} ${String(item.meterName || '')} ${String(item.skuName || '')}`.toLowerCase();
  return !text.includes('windows') && !text.includes('spot') && !text.includes('low priority');
}

export async function getAzureVmMonthlyPriceUsd(input: {
  vmSize: string;
  region?: string | null;
}): Promise<number | null> {
  const vmSize = String(input.vmSize || '').trim();
  if (!vmSize) return null;
  const region = String(input.region || '').trim().toLowerCase();
  if (!region) return null;

  const filter = [
    "serviceName eq 'Virtual Machines'",
    `armRegionName eq '${escapeFilterValue(region)}'`,
    `armSkuName eq '${escapeFilterValue(vmSize)}'`,
    "priceType eq 'Consumption'",
  ].join(' and ');

  const items = await fetchAzurePrices(filter);
  return findFirstMonthlyPrice(items, (item) => isConsumption(item) && isNotWindowsOrSpot(item));
}

export async function getAzureDatabaseMonthlyPriceUsd(input: {
  serviceName: string;
  tier?: string | null;
  region?: string | null;
}): Promise<number | null> {
  const serviceName = String(input.serviceName || '').trim();
  const region = String(input.region || '').trim().toLowerCase();
  if (!serviceName || !region) return null;

  const tier = String(input.tier || '').trim();
  const filterParts = [
    `serviceName eq '${escapeFilterValue(serviceName)}'`,
    `armRegionName eq '${escapeFilterValue(region)}'`,
    "priceType eq 'Consumption'",
  ];
  if (tier) {
    filterParts.push(`contains(skuName, '${escapeFilterValue(tier)}')`);
  }

  const items = await fetchAzurePrices(filterParts.join(' and '));
  return findFirstMonthlyPrice(items, (item) => isConsumption(item));
}

export async function getAzureRedisMonthlyPriceUsd(input: {
  skuName: string;
  region?: string | null;
}): Promise<number | null> {
  const skuName = String(input.skuName || '').trim();
  const region = String(input.region || '').trim().toLowerCase();
  if (!skuName || !region) return null;

  const filter = [
    "serviceName eq 'Azure Cache for Redis'",
    `armRegionName eq '${escapeFilterValue(region)}'`,
    `contains(skuName, '${escapeFilterValue(skuName)}')`,
    "priceType eq 'Consumption'",
  ].join(' and ');

  const items = await fetchAzurePrices(filter);
  return findFirstMonthlyPrice(items, (item) => isConsumption(item));
}

