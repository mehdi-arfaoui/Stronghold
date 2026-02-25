import type { SupportedCurrency } from '../../constants/market-financial-data.js';
import type {
  DrStrategyKey,
  IncidentProbabilityKey,
} from '../../constants/dr-financial-reference-data.js';
import { CurrencyService } from '../currency.service.js';
import {
  resolveCloudProvider,
  resolveCloudServiceResolution,
} from './cloudServiceMapping.js';
import { lookupAwsEstimatedMonthlyUsd } from './pricing/awsPricing.js';
import { lookupAzureEstimatedMonthlyEur } from './pricing/azurePricing.js';
import { lookupGcpEstimatedMonthlyEur } from './pricing/gcpPricing.js';
import { awsProviderAdapter } from './recommendations/awsRecommendations.js';
import { azureProviderAdapter } from './recommendations/azureRecommendations.js';
import { gcpProviderAdapter } from './recommendations/gcpRecommendations.js';
import type {
  CloudProvider,
  CloudServiceResolution,
  CriticalityLevel,
  DrProviderAdapter,
  IncidentProbabilityResult,
  ServiceRecommendationText,
} from './types.js';

type EstimateReference = {
  amount: number;
  currency: 'USD' | 'EUR';
  source: string;
};

const PROVIDER_ADAPTERS: Record<CloudProvider, DrProviderAdapter | null> = {
  aws: awsProviderAdapter,
  azure: azureProviderAdapter,
  gcp: gcpProviderAdapter,
  other: null,
};

function resolveAdapter(provider: CloudProvider): DrProviderAdapter | null {
  return PROVIDER_ADAPTERS[provider] ?? null;
}

export function resolveServiceResolution(options: {
  provider?: string | null;
  nodeType: string;
  metadata?: unknown;
}): CloudServiceResolution {
  return resolveCloudServiceResolution(options);
}

export function lookupEstimatedMonthlyReference(
  resolution: CloudServiceResolution,
): EstimateReference | null {
  if (resolution.provider === 'aws') {
    const amount = lookupAwsEstimatedMonthlyUsd(resolution);
    if (amount == null) return null;
    return {
      amount,
      currency: 'USD',
      source: 'AWS public on-demand estimates (eu-west-3)',
    };
  }

  if (resolution.provider === 'azure') {
    const amount = lookupAzureEstimatedMonthlyEur(resolution);
    if (amount == null) return null;
    return {
      amount,
      currency: 'EUR',
      source: 'Azure public retail estimates (West Europe/France Central)',
    };
  }

  if (resolution.provider === 'gcp') {
    const amount = lookupGcpEstimatedMonthlyEur(resolution);
    if (amount == null) return null;
    return {
      amount,
      currency: 'EUR',
      source: 'GCP public pricing estimates (europe-west1/europe-west9)',
    };
  }

  return null;
}

export function convertEstimateToCurrency(
  estimate: EstimateReference,
  targetCurrency: SupportedCurrency,
): number {
  return CurrencyService.convertAmount(estimate.amount, estimate.currency, targetCurrency);
}

export function resolveProviderFloorStrategy(options: {
  criticality: CriticalityLevel;
  defaultFloor: DrStrategyKey;
  resolution: CloudServiceResolution;
}): DrStrategyKey {
  const adapter = resolveAdapter(options.resolution.provider);
  const providerSpecific =
    adapter?.resolveFloorStrategy(options.criticality, options.defaultFloor, options.resolution) ??
    null;
  return providerSpecific ?? options.defaultFloor;
}

export function resolveProviderNativeCostFactor(options: {
  strategy: DrStrategyKey;
  resolution: CloudServiceResolution;
}): number | null {
  const adapter = resolveAdapter(options.resolution.provider);
  return adapter?.resolveNativeCostFactor(options.strategy, options.resolution) ?? null;
}

export function resolveProviderIncidentProbability(
  resolution: CloudServiceResolution,
): IncidentProbabilityResult | null {
  const adapter = resolveAdapter(resolution.provider);
  return adapter?.resolveIncidentProbability(resolution) ?? null;
}

export function buildProviderServiceRecommendation(options: {
  serviceName: string;
  monthlyLabel: string;
  resolution: CloudServiceResolution;
  strategy: DrStrategyKey;
}): ServiceRecommendationText | null {
  const adapter = resolveAdapter(options.resolution.provider);
  return (
    adapter?.buildRecommendation({
      serviceName: options.serviceName,
      monthlyLabel: options.monthlyLabel,
      resolution: options.resolution,
      strategy: options.strategy,
    }) ?? null
  );
}

export function normalizeCloudProvider(provider: string | null | undefined): CloudProvider {
  return resolveCloudProvider(provider);
}

export type { CloudProvider, CloudServiceResolution } from './types.js';
export type { IncidentProbabilityKey };
