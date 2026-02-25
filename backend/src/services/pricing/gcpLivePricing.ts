import { fetchGcpSkus } from '../gcpPricingService.js';

const HOURS_PER_MONTH = 730;
const GCP_COMPUTE_SERVICE_ID = '6F81-5844-456A';

function parseRegionFromZone(zone: string | null | undefined): string | null {
  const normalized = String(zone || '').trim().toLowerCase();
  if (!normalized) return null;
  const withoutSuffix = normalized.replace(/-[a-z]$/, '');
  return withoutSuffix || null;
}

function toSkuList(rawSkus: unknown[]): Array<Record<string, unknown>> {
  return rawSkus.filter(
    (sku): sku is Record<string, unknown> =>
      Boolean(sku && typeof sku === 'object' && !Array.isArray(sku)),
  );
}

function parseUnitPriceUsd(unitPrice: unknown): number | null {
  if (!unitPrice || typeof unitPrice !== 'object' || Array.isArray(unitPrice)) return null;
  const payload = unitPrice as Record<string, unknown>;
  const units = Number(payload.units ?? 0);
  const nanos = Number(payload.nanos ?? 0);
  const value = units + nanos / 1_000_000_000;
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function extractFirstOnDemandRateUsd(sku: Record<string, unknown>): number | null {
  const pricingInfo = sku.pricingInfo;
  if (!Array.isArray(pricingInfo) || pricingInfo.length === 0) return null;
  const firstPricing = pricingInfo[0];
  if (!firstPricing || typeof firstPricing !== 'object' || Array.isArray(firstPricing)) return null;
  const expression = (firstPricing as Record<string, unknown>).pricingExpression;
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) return null;
  const tieredRates = (expression as Record<string, unknown>).tieredRates;
  if (!Array.isArray(tieredRates) || tieredRates.length === 0) return null;
  const tier = tieredRates[0];
  if (!tier || typeof tier !== 'object' || Array.isArray(tier)) return null;
  return parseUnitPriceUsd((tier as Record<string, unknown>).unitPrice);
}

function isOnDemandSku(sku: Record<string, unknown>): boolean {
  const category = sku.category;
  if (!category || typeof category !== 'object' || Array.isArray(category)) return false;
  const usageType = String((category as Record<string, unknown>).usageType || '').toLowerCase();
  return usageType === 'ondemand' || usageType === 'on_demand' || usageType.length === 0;
}

function skuMatchesMachineType(
  sku: Record<string, unknown>,
  machineType: string,
  region: string | null,
): boolean {
  const description = String(sku.description || '').toLowerCase();
  const machineToken = machineType.toLowerCase();
  if (!description.includes(machineToken)) return false;
  if (description.includes('preemptible') || description.includes('spot')) return false;

  if (!region) return true;
  const serviceRegionsRaw = sku.serviceRegions;
  if (!Array.isArray(serviceRegionsRaw)) return false;
  const serviceRegions = serviceRegionsRaw.map((item) => String(item || '').toLowerCase());
  return serviceRegions.includes(region) || serviceRegions.includes('global');
}

export async function getGcpComputeMonthlyPriceUsd(input: {
  machineType: string;
  zone?: string | null;
}): Promise<number | null> {
  const machineType = String(input.machineType || '').trim();
  if (!machineType) return null;
  const region = parseRegionFromZone(input.zone);

  const response = await fetchGcpSkus({
    serviceId: GCP_COMPUTE_SERVICE_ID,
    pageSize: 1_000,
    maxPages: 4,
  });
  const skus = toSkuList(response.skus);
  const matchingSku = skus.find((sku) => isOnDemandSku(sku) && skuMatchesMachineType(sku, machineType, region));
  if (!matchingSku) return null;

  const hourly = extractFirstOnDemandRateUsd(matchingSku);
  if (hourly == null) return null;
  return Number((hourly * HOURS_PER_MONTH).toFixed(4));
}

