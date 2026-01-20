import { normalizeAwsPriceListEntries } from "../clients/awsPricingClient.js";
import type { NormalizedPricingItem } from "../clients/pricingTypes.js";
import { fetchAwsPricingProducts } from "./awsPricingService.js";

export type AwsComputePriceInput = {
  instanceType: string;
  region: string;
  location?: string;
};

export type AwsUnitPriceResult = {
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

function resolveAwsLocation(region: string, location?: string): string | undefined {
  if (location && location.trim().length > 0) return location.trim();
  const regionMap: Record<string, string> = {
    "us-east-1": "US East (N. Virginia)",
    "us-east-2": "US East (Ohio)",
    "us-west-1": "US West (N. California)",
    "us-west-2": "US West (Oregon)",
    "eu-west-1": "EU (Ireland)",
    "eu-west-2": "EU (London)",
    "eu-west-3": "EU (Paris)",
    "eu-central-1": "EU (Frankfurt)",
  };
  return regionMap[region];
}

export async function fetchAwsComputePricePerHour(
  input: AwsComputePriceInput
): Promise<AwsUnitPriceResult> {
  const location = resolveAwsLocation(input.region, input.location);
  const filtersBase = location ? [{ field: "location", value: location }] : [];
  const response = await fetchAwsPricingProducts({
    serviceCode: "AmazonEC2",
    filters: [
      ...filtersBase,
      { field: "instanceType", value: input.instanceType },
      { field: "operatingSystem", value: "Linux" },
    ],
    maxResults: 50,
    maxPages: 1,
  });

  const items = normalizeAwsPriceListEntries(response.priceList);
  const pick = pickBestItem(items, [
    (item) => item.metadata?.instanceType === input.instanceType && item.unit.toLowerCase().includes("hr"),
  ]);
  const source = pick?.source;

  return {
    pricePerUnit: pick?.pricePerUnit ?? 0,
    currency: pick?.currency ?? "USD",
    ...(source ? { source } : {}),
  };
}

export async function fetchAwsStoragePricePerGbMonth(region: string, location?: string) {
  const resolved = resolveAwsLocation(region, location);
  const filters = resolved ? [{ field: "location", value: resolved }] : [];
  const response = await fetchAwsPricingProducts({
    serviceCode: "AmazonS3",
    filters: [...filters, { field: "productFamily", value: "Storage" }],
    maxResults: 50,
    maxPages: 1,
  });
  const items = normalizeAwsPriceListEntries(response.priceList);
  const pick = pickBestItem(items, [
    (item) => item.unit.toLowerCase().includes("gb"),
    (item) => item.service.toLowerCase().includes("storage"),
  ]);
  const source = pick?.source;
  return {
    pricePerUnit: pick?.pricePerUnit ?? 0,
    currency: pick?.currency ?? "USD",
    ...(source ? { source } : {}),
  };
}

export async function fetchAwsTransferPricePerGb(region: string, location?: string) {
  const resolved = resolveAwsLocation(region, location);
  const filters = resolved ? [{ field: "location", value: resolved }] : [];
  const response = await fetchAwsPricingProducts({
    serviceCode: "AmazonEC2",
    filters: [...filters, { field: "productFamily", value: "Data Transfer" }],
    maxResults: 50,
    maxPages: 1,
  });
  const items = normalizeAwsPriceListEntries(response.priceList);
  const pick = pickBestItem(items, [
    (item) => item.metadata?.usageType?.toString().toLowerCase().includes("data transfer") ?? false,
    (item) => item.service.toLowerCase().includes("transfer"),
  ]);
  const source = pick?.source;
  return {
    pricePerUnit: pick?.pricePerUnit ?? 0,
    currency: pick?.currency ?? "USD",
    ...(source ? { source } : {}),
  };
}
