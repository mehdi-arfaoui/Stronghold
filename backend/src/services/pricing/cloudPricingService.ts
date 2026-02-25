import type { SupportedCurrency } from '../../constants/market-financial-data.js';
import { SUPPORTED_CURRENCIES } from '../../constants/market-financial-data.js';
import { appLogger } from '../../utils/logger.js';
import { CurrencyService } from '../currency.service.js';
import {
  lookupEstimatedMonthlyReference,
  resolveServiceResolution,
} from '../dr-recommendation-engine/recommendationEngine.js';
import { asRecord, readPositiveNumberFromKeys, readStringFromKeys } from '../dr-recommendation-engine/metadataUtils.js';
import type { CloudServiceResolution } from '../dr-recommendation-engine/types.js';
import {
  getAwsEc2MonthlyPriceUsd,
  getAwsElastiCacheMonthlyPriceUsd,
  getAwsRdsMonthlyPriceUsd,
} from './awsLivePricing.js';
import {
  getAzureDatabaseMonthlyPriceUsd,
  getAzureRedisMonthlyPriceUsd,
  getAzureVmMonthlyPriceUsd,
} from './azureLivePricing.js';
import { getGcpComputeMonthlyPriceUsd } from './gcpLivePricing.js';
import {
  pricingSourceLabel,
  type PricingResult,
  type PricingSource,
} from './pricingTypes.js';

type CloudPricingInput = {
  nodeType: string;
  provider?: string | null;
  metadata?: unknown;
  preferredCurrency?: unknown;
};

type CachedPricingResult = {
  result: PricingResult;
  expiresAt: number;
};

function normalizeCurrency(rawCurrency: unknown): SupportedCurrency {
  if (typeof rawCurrency === 'string') {
    const normalized = rawCurrency.toUpperCase();
    if ((SUPPORTED_CURRENCIES as readonly string[]).includes(normalized)) {
      return normalized as SupportedCurrency;
    }
  }
  return 'EUR';
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function buildPricingResult(input: {
  monthlyCostUsd: number;
  source: PricingSource;
  currency: SupportedCurrency;
  confidence: number;
  note: string;
}): PricingResult {
  const monthlyCostUsd = Math.max(0, input.monthlyCostUsd);
  const monthlyCost = CurrencyService.convertAmount(monthlyCostUsd, 'USD', input.currency);
  return {
    monthlyCost: Number(monthlyCost.toFixed(4)),
    monthlyCostUsd: Number(monthlyCostUsd.toFixed(4)),
    source: input.source,
    sourceLabel: pricingSourceLabel(input.source),
    confidence: input.confidence,
    currency: input.currency,
    note: input.note,
  };
}

function resolveAwsRegion(metadata: Record<string, unknown>): string {
  const region = readStringFromKeys(metadata, ['region', 'awsRegion', 'location', 'regionName']);
  if (region) return region;
  const availabilityZone = readStringFromKeys(metadata, ['availabilityZone', 'availability_zone']);
  if (availabilityZone) {
    return availabilityZone.replace(/-[a-z]$/, '');
  }
  return 'eu-west-3';
}

function resolveAzureRegion(metadata: Record<string, unknown>): string {
  const region = readStringFromKeys(metadata, ['region', 'location', 'armRegionName']);
  return region ? region.toLowerCase() : 'westeurope';
}

function resolveGcpZone(metadata: Record<string, unknown>): string {
  const zone = readStringFromKeys(metadata, ['zone', 'location', 'region']);
  return zone || 'europe-west1-b';
}

function resolveObservedMonthlyCostUsd(metadata: Record<string, unknown>): number | null {
  const cloudCost = asRecord(metadata.cloudCost);
  const monthlyUsd = readPositiveNumberFromKeys(metadata, [
    'realMonthlyCostUSD',
    'realMonthlyCostUsd',
    'monthlyCostUSD',
    'observedMonthlyCostUSD',
    'realMonthlyCost',
  ]) ?? readPositiveNumberFromKeys(cloudCost, ['monthlyTotalUSD', 'realMonthlyCostUSD', 'monthlyCostUSD']);

  if (monthlyUsd != null) {
    return monthlyUsd;
  }

  const monthlyEur =
    readPositiveNumberFromKeys(metadata, [
      'realMonthlyCostEUR',
      'realMonthlyCostEur',
      'monthlyCostEUR',
      'observedMonthlyCostEUR',
    ]) ??
    readPositiveNumberFromKeys(cloudCost, ['monthlyTotalEUR', 'realMonthlyCostEUR', 'monthlyCostEUR']);
  if (monthlyEur == null) return null;

  return CurrencyService.convertAmount(monthlyEur, 'EUR', 'USD');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('pricing_timeout')), timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export class CloudPricingService {
  private readonly cache = new Map<string, CachedPricingResult>();

  private readonly cacheTtlMs = 24 * 60 * 60 * 1000;

  private readonly requestTimeoutMs = 5_000;

  constructor() {
    appLogger.info('financial.live_pricing.initialized', {
      awsPricingConfigured: Boolean(
        process.env.AWS_PRICING_ACCESS_KEY_ID && process.env.AWS_PRICING_SECRET_ACCESS_KEY,
      ),
      gcpPricingConfigured: Boolean(process.env.GCP_PRICING_API_KEY),
      azurePricingAvailable: true,
      awsPricingRegion: process.env.AWS_PRICING_REGION || 'us-east-1',
      usdEurRate: process.env.USD_EUR_RATE || '0.92 (fallback)',
      cacheTtlHours: this.cacheTtlMs / (60 * 60 * 1000),
      requestTimeoutMs: this.requestTimeoutMs,
    });
  }

  async getResourceMonthlyCost(input: CloudPricingInput): Promise<PricingResult> {
    const currency = normalizeCurrency(input.preferredCurrency);
    const metadata = asRecord(input.metadata);
    const resolution = resolveServiceResolution({
      nodeType: input.nodeType,
      provider: input.provider ?? null,
      metadata,
    });

    const cacheKey = `${resolution.provider}:${resolution.kind}:${currency}:${JSON.stringify(metadata)}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      appLogger.info('financial.live_pricing.cache_hit', {
        provider: resolution.provider,
        kind: resolution.kind,
        source: cached.result.source,
      });
      return cached.result;
    }

    const observedMonthlyCostUsd = resolveObservedMonthlyCostUsd(metadata);
    if (observedMonthlyCostUsd != null) {
      const result = buildPricingResult({
        monthlyCostUsd: observedMonthlyCostUsd,
        source: 'cost-explorer',
        currency,
        confidence: 0.95,
        note: 'Observed cloud billing metadata',
      });
      this.cache.set(cacheKey, { result, expiresAt: now + this.cacheTtlMs });
      return result;
    }

    try {
      appLogger.info('financial.live_pricing.fetch_attempt', {
        provider: resolution.provider,
        kind: resolution.kind,
      });
      const liveMonthlyCostUsd = await withTimeout(
        this.fetchLiveMonthlyCostUsd(resolution),
        this.requestTimeoutMs,
      );
      if (liveMonthlyCostUsd != null) {
        appLogger.info('financial.live_pricing.fetch_success', {
          provider: resolution.provider,
          kind: resolution.kind,
          monthlyCostUsd: Number(liveMonthlyCostUsd.toFixed(4)),
        });
        const result = buildPricingResult({
          monthlyCostUsd: liveMonthlyCostUsd,
          source: 'pricing-api',
          currency,
          confidence: 0.9,
          note: 'Live cloud pricing API',
        });
        this.cache.set(cacheKey, { result, expiresAt: now + this.cacheTtlMs });
        return result;
      }
    } catch (error) {
      appLogger.warn('financial.live_pricing.unavailable', {
        provider: resolution.provider,
        kind: resolution.kind,
        reason: error instanceof Error ? error.message : 'unknown_error',
      });
    }

    const fallback = this.getStaticFallback(resolution, currency);
    appLogger.info('financial.live_pricing.fallback_static', {
      provider: resolution.provider,
      kind: resolution.kind,
      note: fallback.note,
    });
    this.cache.set(cacheKey, { result: fallback, expiresAt: now + this.cacheTtlMs });
    return fallback;
  }

  private async fetchLiveMonthlyCostUsd(resolution: CloudServiceResolution): Promise<number | null> {
    const metadata = resolution.metadata;

    if (resolution.provider === 'aws') {
      const region = resolveAwsRegion(metadata);
      if (resolution.kind === 'ec2') {
        const instanceType = readStringFromKeys(metadata, ['instanceType', 'instance_type', 'vmSize']);
        if (!instanceType) return null;
        return getAwsEc2MonthlyPriceUsd({ instanceType, region });
      }
      if (resolution.kind === 'rds') {
        const instanceClass = readStringFromKeys(metadata, [
          'dbInstanceClass',
          'instanceClass',
          'instanceType',
        ]);
        if (!instanceClass) return null;
        const engine = readStringFromKeys(metadata, ['engine', 'databaseEngine']);
        return getAwsRdsMonthlyPriceUsd({ instanceClass, engine, region });
      }
      if (resolution.kind === 'elasticache') {
        const nodeType = readStringFromKeys(metadata, ['cacheNodeType', 'instanceType', 'nodeType']);
        if (!nodeType) return null;
        const engine = readStringFromKeys(metadata, ['engine', 'cacheEngine']);
        return getAwsElastiCacheMonthlyPriceUsd({ nodeType, engine, region });
      }
      return null;
    }

    if (resolution.provider === 'azure') {
      const region = resolveAzureRegion(metadata);
      if (resolution.kind === 'vm' || resolution.kind === 'virtualMachineScaleSet') {
        const vmSize = readStringFromKeys(metadata, ['vmSize', 'armSkuName', 'skuName', 'instanceType']);
        if (!vmSize) return null;
        return getAzureVmMonthlyPriceUsd({ vmSize, region });
      }
      if (resolution.kind === 'sqlDatabase') {
        const tier = readStringFromKeys(metadata, [
          'tier',
          'skuName',
          'serviceObjectiveName',
          'currentServiceObjectiveName',
        ]);
        return getAzureDatabaseMonthlyPriceUsd({
          serviceName: 'SQL Database',
          tier,
          region,
        });
      }
      if (resolution.kind === 'postgresqlFlexible') {
        const tier = readStringFromKeys(metadata, ['tier', 'skuName', 'sku', 'instanceType']);
        return getAzureDatabaseMonthlyPriceUsd({
          serviceName: 'Azure Database for PostgreSQL',
          tier,
          region,
        });
      }
      if (resolution.kind === 'mysqlFlexible') {
        const tier = readStringFromKeys(metadata, ['tier', 'skuName', 'sku', 'instanceType']);
        return getAzureDatabaseMonthlyPriceUsd({
          serviceName: 'Azure Database for MySQL',
          tier,
          region,
        });
      }
      if (resolution.kind === 'redis') {
        const skuName = readStringFromKeys(metadata, ['skuName', 'sku', 'tier']);
        if (!skuName) return null;
        return getAzureRedisMonthlyPriceUsd({ skuName, region });
      }
      return null;
    }

    if (resolution.provider === 'gcp') {
      if (!process.env.GCP_PRICING_API_KEY) return null;
      if (resolution.kind !== 'computeEngine') return null;
      const machineType = readStringFromKeys(metadata, ['machineType', 'instanceType', 'tier']);
      if (!machineType) return null;
      const zone = resolveGcpZone(metadata);
      return getGcpComputeMonthlyPriceUsd({ machineType, zone });
    }

    return null;
  }

  private getStaticFallback(
    resolution: CloudServiceResolution,
    currency: SupportedCurrency,
  ): PricingResult {
    const staticEstimate = lookupEstimatedMonthlyReference(resolution);
    if (staticEstimate) {
      const monthlyCostUsd = CurrencyService.convertAmount(
        staticEstimate.amount,
        staticEstimate.currency,
        'USD',
      );
      return buildPricingResult({
        monthlyCostUsd,
        source: 'static-table',
        currency,
        confidence: 0.75,
        note: staticEstimate.source,
      });
    }

    // Ultimate deterministic fallback for unknown services.
    const fallbackUsd = toPositiveNumber(process.env.DEFAULT_MONTHLY_COST_USD) ?? 50;
    return buildPricingResult({
      monthlyCostUsd: fallbackUsd,
      source: 'static-table',
      currency,
      confidence: 0.75,
      note: 'Static fallback default',
    });
  }
}

export const cloudPricingService = new CloudPricingService();
