import type { SupportedCurrency } from '../../constants/market-financial-data.js';

export type PricingSource = 'cost-explorer' | 'pricing-api' | 'static-table';

export type PricingSourceLabel = '[Prix reel ✓✓]' | '[Prix API ✓]' | '[Estimation ≈]';

export type PricingResult = {
  monthlyCost: number;
  monthlyCostUsd: number;
  source: PricingSource;
  sourceLabel: PricingSourceLabel;
  confidence: number;
  currency: SupportedCurrency;
  note: string;
};

export function pricingSourceLabel(source: PricingSource): PricingSourceLabel {
  if (source === 'cost-explorer') return '[Prix reel ✓✓]';
  if (source === 'pricing-api') return '[Prix API ✓]';
  return '[Estimation ≈]';
}

