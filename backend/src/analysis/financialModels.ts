export type CostEstimate = {
  capex: number;
  opexMonthly: number;
  currency: string;
};

export type FinancialAdjustments = {
  exchangeRate?: number;
  discountRate?: number;
  humanCostMonthly?: number;
  outputCurrency?: string;
};

export type AdjustedCost = {
  base: CostEstimate;
  adjusted: CostEstimate;
  totalMonthly: number;
  discountRate: number;
  exchangeRate: number;
  humanCostMonthly: number;
};

const DEFAULT_CURRENCY = "EUR";

export function defaultBudgetForCriticality(
  criticality: "low" | "medium" | "high" | "critical"
): CostEstimate {
  switch (criticality) {
    case "low":
      return { capex: 8000, opexMonthly: 800, currency: DEFAULT_CURRENCY };
    case "medium":
      return { capex: 25000, opexMonthly: 2500, currency: DEFAULT_CURRENCY };
    case "high":
      return { capex: 60000, opexMonthly: 6000, currency: DEFAULT_CURRENCY };
    case "critical":
    default:
      return { capex: 120000, opexMonthly: 12000, currency: DEFAULT_CURRENCY };
  }
}

export function budgetFromLevel(level: "low" | "medium" | "high"): CostEstimate {
  if (level === "low") {
    return { capex: 15000, opexMonthly: 1500, currency: DEFAULT_CURRENCY };
  }
  if (level === "medium") {
    return { capex: 40000, opexMonthly: 4000, currency: DEFAULT_CURRENCY };
  }
  return { capex: 90000, opexMonthly: 9000, currency: DEFAULT_CURRENCY };
}

export function formatCostEstimate(cost: CostEstimate): string {
  const capex = Math.round(cost.capex);
  const opex = Math.round(cost.opexMonthly);
  return `${capex.toLocaleString("fr-FR")} ${cost.currency} CAPEX / ${opex.toLocaleString(
    "fr-FR"
  )} ${cost.currency} OPEX mensuel`;
}

export function applyFinancialAdjustments(cost: CostEstimate, adjustments: FinancialAdjustments = {}): AdjustedCost {
  const exchangeRate = Number.isFinite(adjustments.exchangeRate) ? (adjustments.exchangeRate as number) : 1;
  const discountRate = clampRate(adjustments.discountRate ?? 0);
  const humanCostMonthly = Math.max(0, adjustments.humanCostMonthly ?? 0);
  const currency = adjustments.outputCurrency || cost.currency;

  const base: CostEstimate = {
    capex: cost.capex * exchangeRate,
    opexMonthly: cost.opexMonthly * exchangeRate,
    currency,
  };

  const adjusted: CostEstimate = {
    capex: base.capex * (1 - discountRate),
    opexMonthly: (base.opexMonthly * (1 - discountRate)) + humanCostMonthly * exchangeRate,
    currency,
  };

  return {
    base,
    adjusted,
    totalMonthly: adjusted.capex + adjusted.opexMonthly,
    discountRate,
    exchangeRate,
    humanCostMonthly,
  };
}

export function sumCostEstimates(costs: CostEstimate[], currency = DEFAULT_CURRENCY): CostEstimate {
  return costs.reduce(
    (acc, cost) => ({
      capex: acc.capex + cost.capex,
      opexMonthly: acc.opexMonthly + cost.opexMonthly,
      currency: cost.currency || acc.currency,
    }),
    { capex: 0, opexMonthly: 0, currency }
  );
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
