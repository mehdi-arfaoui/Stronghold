export type FinancialFieldKey =
  | 'employeeCount'
  | 'annualRevenue'
  | 'annualITBudget'
  | 'drBudgetPercent'
  | 'hourlyDowntimeCost';

export type FinancialFieldSource = 'user_input' | 'suggested' | 'inferred';

type FinancialSuggestionSet = Record<FinancialFieldKey, number>;

const BASE_SUGGESTIONS_EUR: Record<string, FinancialSuggestionSet> = {
  startup: {
    employeeCount: 25,
    annualRevenue: 3_000_000,
    annualITBudget: 150_000,
    drBudgetPercent: 3,
    hourlyDowntimeCost: 1_500,
  },
  smb: {
    employeeCount: 150,
    annualRevenue: 25_000_000,
    annualITBudget: 1_250_000,
    drBudgetPercent: 4,
    hourlyDowntimeCost: 15_000,
  },
  midMarket: {
    employeeCount: 800,
    annualRevenue: 150_000_000,
    annualITBudget: 6_000_000,
    drBudgetPercent: 4,
    hourlyDowntimeCost: 80_000,
  },
  enterprise: {
    employeeCount: 5_000,
    annualRevenue: 1_000_000_000,
    annualITBudget: 40_000_000,
    drBudgetPercent: 5,
    hourlyDowntimeCost: 400_000,
  },
  largeEnterprise: {
    employeeCount: 5_000,
    annualRevenue: 1_000_000_000,
    annualITBudget: 40_000_000,
    drBudgetPercent: 5,
    hourlyDowntimeCost: 400_000,
  },
};

const USD_TO_TARGET_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CHF: 0.88,
};

function convertFromEur(amount: number, currency: string): number {
  const eurRate = USD_TO_TARGET_RATES.EUR;
  const targetRate = USD_TO_TARGET_RATES[String(currency || 'EUR').toUpperCase()] ?? eurRate;
  return amount * (targetRate / eurRate);
}

export function mapApiSourceToEditableSource(source: string | undefined): FinancialFieldSource {
  const normalized = String(source || '').toLowerCase();
  if (normalized === 'user_input') return 'user_input';
  if (normalized === 'suggested') return 'suggested';
  return 'inferred';
}

export function getSizeSuggestions(sizeCategory: string, currency: string): FinancialSuggestionSet {
  const base = BASE_SUGGESTIONS_EUR[sizeCategory] || BASE_SUGGESTIONS_EUR.midMarket;
  return {
    employeeCount: base.employeeCount,
    annualRevenue: Math.round(convertFromEur(base.annualRevenue, currency)),
    annualITBudget: Math.round(convertFromEur(base.annualITBudget, currency)),
    drBudgetPercent: base.drBudgetPercent,
    hourlyDowntimeCost: Math.round(convertFromEur(base.hourlyDowntimeCost, currency)),
  };
}

export function applySizeSuggestions(input: {
  sizeCategory: string;
  currency: string;
  values: Record<FinancialFieldKey, string>;
  sources: Partial<Record<FinancialFieldKey, FinancialFieldSource>>;
}): {
  values: Record<FinancialFieldKey, string>;
  sources: Partial<Record<FinancialFieldKey, FinancialFieldSource>>;
  suggestedFields: FinancialFieldKey[];
} {
  const suggestions = getSizeSuggestions(input.sizeCategory, input.currency);
  const nextValues = { ...input.values };
  const nextSources = { ...input.sources };
  const suggestedFields: FinancialFieldKey[] = [];

  (Object.keys(suggestions) as FinancialFieldKey[]).forEach((field) => {
    if (nextSources[field] === 'user_input') return;
    const currentValue = String(nextValues[field] || '').trim();
    const shouldSuggest =
      currentValue.length === 0 || nextSources[field] === 'inferred' || nextSources[field] === 'suggested';
    if (!shouldSuggest) return;

    nextValues[field] = String(suggestions[field]);
    nextSources[field] = 'suggested';
    suggestedFields.push(field);
  });

  return {
    values: nextValues,
    sources: nextSources,
    suggestedFields,
  };
}
