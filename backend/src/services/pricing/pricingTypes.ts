import type { SupportedCurrency } from '../../constants/market-financial-data.js';

export type PricingSource =
  | 'cost-explorer'
  | 'pricing-api'
  | 'static-table'
  | 'family-estimate'
  | 'category-estimate';

export type PricingSourceLabel =
  | 'Prix reel'
  | 'Prix API live'
  | 'Table statique'
  | 'Estimation famille'
  | 'Estimation categorie';

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
  if (source === 'cost-explorer') return 'Prix reel';
  if (source === 'pricing-api') return 'Prix API live';
  if (source === 'family-estimate') return 'Estimation famille';
  if (source === 'category-estimate') return 'Estimation categorie';
  return 'Table statique';
}
