export type NormalizedPricingItem = {
  provider: "aws" | "azure" | "gcp";
  service: string;
  sku: string;
  region: string | null;
  unit: string;
  currency: string;
  pricePerUnit: number;
  capex: number;
  opexMonthly: number;
  source: string;
  metadata?: Record<string, string | number | null>;
};

export type PricingAdjustments = {
  exchangeRate?: number;
  discountRate?: number;
  humanCostMonthly?: number;
  currency?: string;
};

export type PricingSummary = {
  baseCapex: number;
  baseOpexMonthly: number;
  adjustedCapex: number;
  adjustedOpexMonthly: number;
  currency: string;
  discountRate: number;
  exchangeRate: number;
  humanCostMonthly: number;
};

export function summarizePricing(items: NormalizedPricingItem[], adjustments: PricingAdjustments = {}): PricingSummary {
  const baseCapex = items.reduce((sum, item) => sum + item.capex, 0);
  const baseOpexMonthly = items.reduce((sum, item) => sum + item.opexMonthly, 0);
  const discountRate = clampRate(adjustments.discountRate ?? 0);
  const exchangeRate = Number.isFinite(adjustments.exchangeRate) ? (adjustments.exchangeRate as number) : 1;
  const humanCostMonthly = Math.max(0, adjustments.humanCostMonthly ?? 0);
  const currency = adjustments.currency || items[0]?.currency || "EUR";

  const adjustedCapex = baseCapex * exchangeRate * (1 - discountRate);
  const adjustedOpexMonthly = baseOpexMonthly * exchangeRate * (1 - discountRate) + humanCostMonthly;

  return {
    baseCapex,
    baseOpexMonthly,
    adjustedCapex,
    adjustedOpexMonthly,
    currency,
    discountRate,
    exchangeRate,
    humanCostMonthly,
  };
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
