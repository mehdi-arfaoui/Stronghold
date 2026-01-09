import { NormalizedPricingItem } from "./pricingTypes.js";

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const parsed = Number(String(value).replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateMonthlyOpex(pricePerUnit: number, unit: string): number {
  const normalizedUnit = unit.toLowerCase();
  if (normalizedUnit.includes("hour")) {
    return pricePerUnit * 730;
  }
  return pricePerUnit;
}

export function normalizeAzurePricingResponse(payload: any): NormalizedPricingItem[] {
  if (!payload) return [];
  const items = Array.isArray(payload.Items) ? payload.Items : Array.isArray(payload.items) ? payload.items : [];

  return items.map((item: any) => {
    const pricePerUnit = toNumber(item.retailPrice ?? item.unitPrice ?? item.price);
    const unit = item.unitOfMeasure ?? item.unit ?? "Hour";
    return {
      provider: "azure",
      service: item.serviceName ?? item.productName ?? "Azure",
      sku: item.skuName ?? item.skuId ?? item.meterId ?? "unknown",
      region: item.armRegionName ?? item.location ?? null,
      unit,
      currency: item.currencyCode ?? item.currency ?? "USD",
      pricePerUnit,
      capex: 0,
      opexMonthly: estimateMonthlyOpex(pricePerUnit, unit),
      source: "azure-retail",
      metadata: {
        product: item.productName ?? null,
        meterName: item.meterName ?? null,
      },
    };
  });
}
