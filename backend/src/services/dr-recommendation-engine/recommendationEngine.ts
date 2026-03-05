import type { SupportedCurrency } from '../../constants/market-financial-data.js';
import type {
  DrStrategyKey,
  IncidentProbabilityKey,
} from '../../constants/dr-financial-reference-data.js';
import { CurrencyService } from '../currency.service.js';
import { cloudPricingService } from '../pricing/cloudPricingService.js';
import type { PricingResult } from '../pricing/pricingTypes.js';
import { lookupStaticPrice } from '../pricing/pricingLoader.js';
import {
  resolveCloudProvider,
  resolveCloudServiceResolution,
} from './cloudServiceMapping.js';
import { readStringFromKeys } from './metadataUtils.js';
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
  if (resolution.provider === 'other') return null;

  const metadata = resolution.metadata;
  const rawRegion =
    readStringFromKeys(metadata, ['region', 'location', 'zone', 'availabilityZone']) ||
    undefined;
  const region = rawRegion ? rawRegion.replace(/-[a-z]$/i, '') : undefined;
  const candidates = [
    readStringFromKeys(metadata, ['instanceType', 'instance_type', 'vmSize', 'machineType']),
    readStringFromKeys(metadata, ['dbInstanceClass', 'instanceClass', 'tier']),
    readStringFromKeys(metadata, ['cacheNodeType', 'nodeType', 'skuName', 'sku']),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      const segments = value.split('/');
      return segments[segments.length - 1] || value;
    });

  for (const candidate of candidates) {
    const staticPrice = lookupStaticPrice(resolution.provider, candidate, region);
    if (!staticPrice || staticPrice.priceUSD <= 0) continue;
    return {
      amount: staticPrice.priceUSD,
      currency: 'USD',
      source: `Static pricing catalog (${staticPrice.matchType}, ${staticPrice.matchedRegion})`,
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

export async function resolveRecommendationPricing(options: {
  provider?: string | null;
  nodeType: string;
  metadata?: unknown;
  preferredCurrency?: unknown;
}): Promise<PricingResult> {
  return cloudPricingService.getResourceMonthlyCost({
    provider: options.provider ?? null,
    nodeType: options.nodeType,
    metadata: options.metadata,
    preferredCurrency: options.preferredCurrency,
  });
}

export type { CloudProvider, CloudServiceResolution } from './types.js';
export type { IncidentProbabilityKey };
