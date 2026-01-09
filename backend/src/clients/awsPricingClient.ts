import { NormalizedPricingItem } from "./pricingTypes.js";

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const parsed = Number(String(value).replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function estimateMonthlyOpex(pricePerUnit: number, unit: string): number {
  const normalizedUnit = unit.toLowerCase();
  if (normalizedUnit.includes("hour") || normalizedUnit.includes("hrs")) {
    return pricePerUnit * 730;
  }
  return pricePerUnit;
}

export function normalizeAwsPricingResponse(payload: any): NormalizedPricingItem[] {
  if (!payload) return [];

  if (Array.isArray(payload.items)) {
    return payload.items.map((item: any) => {
      const pricePerUnit = toNumber(item.pricePerUnit ?? item.price ?? item.onDemandPrice);
      const unit = item.unit ?? "Hrs";
      return {
        provider: "aws",
        service: item.service ?? item.serviceName ?? "AWS",
        sku: item.sku ?? item.productId ?? "unknown",
        region: item.region ?? item.location ?? null,
        unit,
        currency: item.currency ?? "USD",
        pricePerUnit,
        capex: 0,
        opexMonthly: estimateMonthlyOpex(pricePerUnit, unit),
        source: "aws-pricing",
        metadata: {
          instanceType: item.instanceType ?? null,
        },
      };
    });
  }

  const products = payload.products ?? {};
  const terms = payload.terms?.OnDemand ?? {};
  const items: NormalizedPricingItem[] = [];

  Object.entries<any>(terms).forEach(([sku, termMap]) => {
    const product = products[sku] ?? {};
    const service = product?.attributes?.servicename ?? product?.productFamily ?? "AWS";
    const region = product?.attributes?.location ?? product?.attributes?.regionCode ?? null;

    Object.values<any>(termMap).forEach((term) => {
      const priceDimensions = term.priceDimensions ?? {};
      Object.values<any>(priceDimensions).forEach((dim) => {
        const pricePerUnit = toNumber(dim.pricePerUnit?.USD ?? dim.pricePerUnit?.EUR ?? dim.pricePerUnit);
        const unit = dim.unit ?? "Hrs";
        items.push({
          provider: "aws",
          service,
          sku,
          region,
          unit,
          currency: dim.pricePerUnit?.USD ? "USD" : dim.pricePerUnit?.EUR ? "EUR" : "USD",
          pricePerUnit,
          capex: 0,
          opexMonthly: estimateMonthlyOpex(pricePerUnit, unit),
          source: "aws-pricing",
          metadata: {
            instanceType: product?.attributes?.instanceType ?? null,
            usageType: dim?.description ?? null,
          },
        });
      });
    });
  });

  return items;
}
