import { normalizeAzurePricingResponse } from "../clients/azurePricingClient.js";
import type { NormalizedPricingItem } from "../clients/pricingTypes.js";
import { fetchAzureRetailPrices } from "./azurePricingService.js";

export type AzureComputePriceInput = {
  skuName: string;
  region: string;
};

export type AzureUnitPriceResult = {
  pricePerUnit: number;
  currency: string;
  source?: string;
};

function pickBestItem(
  items: NormalizedPricingItem[],
  filters: Array<(item: NormalizedPricingItem) => boolean>
): NormalizedPricingItem | undefined {
  for (const filter of filters) {
    const match = items.find(filter);
    if (match) return match;
  }
  return items[0];
}

function buildRegionFilter(region: string) {
  return region ? `armRegionName eq '${region}'` : "";
}

export async function fetchAzureComputePricePerHour(
  input: AzureComputePriceInput
): Promise<AzureUnitPriceResult> {
  const regionFilter = buildRegionFilter(input.region);
  const filter = [
    "serviceName eq 'Virtual Machines'",
    `skuName eq '${input.skuName}'`,
    regionFilter,
  ]
    .filter(Boolean)
    .join(" and ");

  const response = await fetchAzureRetailPrices({ filter, pageSize: 50, maxPages: 1 });
  const items = normalizeAzurePricingResponse({ Items: response.items });
  const pick = pickBestItem(items, [(item) => item.unit.toLowerCase().includes("hour")]);

  return {
    pricePerUnit: pick?.pricePerUnit ?? 0,
    currency: pick?.currency ?? "USD",
    source: pick?.source,
  };
}

export async function fetchAzureStoragePricePerGbMonth(region: string) {
  const regionFilter = buildRegionFilter(region);
  const filter = ["serviceName eq 'Storage'", regionFilter].filter(Boolean).join(" and ");
  const response = await fetchAzureRetailPrices({ filter, pageSize: 50, maxPages: 1 });
  const items = normalizeAzurePricingResponse({ Items: response.items });
  const pick = pickBestItem(items, [(item) => item.unit.toLowerCase().includes("gb")]);
  return {
    pricePerUnit: pick?.pricePerUnit ?? 0,
    currency: pick?.currency ?? "USD",
    source: pick?.source,
  };
}

export async function fetchAzureTransferPricePerGb(region: string) {
  const regionFilter = buildRegionFilter(region);
  const filter = ["serviceName eq 'Bandwidth'", regionFilter].filter(Boolean).join(" and ");
  const response = await fetchAzureRetailPrices({ filter, pageSize: 50, maxPages: 1 });
  const items = normalizeAzurePricingResponse({ Items: response.items });
  const pick = pickBestItem(items, [(item) => item.unit.toLowerCase().includes("gb")]);
  return {
    pricePerUnit: pick?.pricePerUnit ?? 0,
    currency: pick?.currency ?? "USD",
    source: pick?.source,
  };
}
