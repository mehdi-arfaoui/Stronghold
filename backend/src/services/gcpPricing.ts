import { normalizeGcpPricingResponse } from "../clients/gcpPricingClient.js";
import type { NormalizedPricingItem } from "../clients/pricingTypes.js";
import { fetchGcpSkus } from "./gcpPricingService.js";

export type GcpComputePriceInput = {
  serviceId: string;
  instanceDescriptor: string;
};

export type GcpUnitPriceResult = {
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

export async function fetchGcpComputePricePerHour(
  input: GcpComputePriceInput
): Promise<GcpUnitPriceResult> {
  const response = await fetchGcpSkus({ serviceId: input.serviceId, pageSize: 200, maxPages: 1 });
  const items = normalizeGcpPricingResponse({ skus: response.skus });
  const descriptor = input.instanceDescriptor.toLowerCase();
  const pick = pickBestItem(items, [
    (item) => item.metadata?.description?.toString().toLowerCase().includes(descriptor),
    (item) => item.unit.toLowerCase().includes("hour"),
  ]);
  return {
    pricePerUnit: pick?.pricePerUnit ?? 0,
    currency: pick?.currency ?? "USD",
    source: pick?.source,
  };
}

export async function fetchGcpStoragePricePerGbMonth(serviceId: string) {
  const response = await fetchGcpSkus({ serviceId, pageSize: 200, maxPages: 1 });
  const items = normalizeGcpPricingResponse({ skus: response.skus });
  const pick = pickBestItem(items, [(item) => item.unit.toLowerCase().includes("gb")]);
  return {
    pricePerUnit: pick?.pricePerUnit ?? 0,
    currency: pick?.currency ?? "USD",
    source: pick?.source,
  };
}

export async function fetchGcpTransferPricePerGb(serviceId: string) {
  const response = await fetchGcpSkus({ serviceId, pageSize: 200, maxPages: 1 });
  const items = normalizeGcpPricingResponse({ skus: response.skus });
  const pick = pickBestItem(items, [
    (item) => item.metadata?.description?.toString().toLowerCase().includes("egress"),
    (item) => item.unit.toLowerCase().includes("gb"),
  ]);
  return {
    pricePerUnit: pick?.pricePerUnit ?? 0,
    currency: pick?.currency ?? "USD",
    source: pick?.source,
  };
}
