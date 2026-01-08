import { NormalizedPricingItem } from "./pricingTypes";

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

export function normalizeGcpPricingResponse(payload: any): NormalizedPricingItem[] {
  if (!payload) return [];
  const skus = Array.isArray(payload.skus) ? payload.skus : Array.isArray(payload.items) ? payload.items : [];

  return skus.flatMap((sku: any) => {
    const service = sku.category?.resourceFamily ?? sku.serviceDisplayName ?? "GCP";
    const region = Array.isArray(sku.serviceRegions) ? sku.serviceRegions[0] : null;
    const pricingInfo = Array.isArray(sku.pricingInfo) ? sku.pricingInfo : [];

    if (pricingInfo.length === 0) {
      const pricePerUnit = toNumber(sku.pricePerUnit ?? sku.price);
      const unit = sku.unitDescription ?? sku.unit ?? "Hour";
      return [
        {
          provider: "gcp",
          service,
          sku: sku.skuId ?? sku.name ?? "unknown",
          region,
          unit,
          currency: sku.currency ?? "USD",
          pricePerUnit,
          capex: 0,
          opexMonthly: estimateMonthlyOpex(pricePerUnit, unit),
          source: "gcp-pricing",
          metadata: {
            description: sku.description ?? null,
          },
        },
      ];
    }

    return pricingInfo.flatMap((info: any) => {
      const pricingExpression = info.pricingExpression ?? {};
      const unit = pricingExpression.usageUnit ?? "Hour";
      const tieredRates = pricingExpression.tieredRates ?? [];
      const unitPrice = tieredRates[0]?.unitPrice ?? pricingExpression.unitPrice ?? {};
      const pricePerUnit = toNumber(unitPrice.units) + toNumber(unitPrice.nanos) / 1e9;

      return {
        provider: "gcp",
        service,
        sku: sku.skuId ?? sku.name ?? "unknown",
        region,
        unit,
        currency: pricingExpression.unitPrice?.currencyCode ?? "USD",
        pricePerUnit,
        capex: 0,
        opexMonthly: estimateMonthlyOpex(pricePerUnit, unit),
        source: "gcp-pricing",
        metadata: {
          description: sku.description ?? null,
        },
      } as NormalizedPricingItem;
    });
  });
}
