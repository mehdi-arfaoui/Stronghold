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
  getAwsEc2MonthlyPriceUsdWithDiagnostics,
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

type LivePricingFallbackReason = 'no_live_match' | 'error';

type PricingSelfTestStatus = 'unknown' | 'ok' | 'failed' | 'skipped';

export type PricingConnectivityProviderStatus = {
  configured: boolean;
  status: PricingSelfTestStatus;
  message: string;
  checkedAt: string | null;
  latencyMs: number | null;
  details: Record<string, unknown>;
};

export type PricingConnectivityStatus = {
  checkedAt: string | null;
  requestTimeoutMs: number;
  providers: {
    azure: PricingConnectivityProviderStatus;
    aws: PricingConnectivityProviderStatus;
    gcp: PricingConnectivityProviderStatus;
  };
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

function metadataDebugKeys(metadata: Record<string, unknown>): string[] {
  return Object.keys(metadata).slice(0, 12);
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

  private connectivityStatus: PricingConnectivityStatus;

  constructor() {
    this.connectivityStatus = this.buildInitialConnectivityStatus();
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

  private buildInitialConnectivityStatus(): PricingConnectivityStatus {
    const awsConfigured = Boolean(
      String(process.env.AWS_PRICING_ACCESS_KEY_ID || '').trim() &&
        String(process.env.AWS_PRICING_SECRET_ACCESS_KEY || '').trim(),
    );
    const gcpConfigured = Boolean(String(process.env.GCP_PRICING_API_KEY || '').trim());

    return {
      checkedAt: null,
      requestTimeoutMs: this.requestTimeoutMs,
      providers: {
        azure: {
          configured: true,
          status: 'unknown',
          message: 'Self-test not run yet',
          checkedAt: null,
          latencyMs: null,
          details: {},
        },
        aws: {
          configured: awsConfigured,
          status: awsConfigured ? 'unknown' : 'skipped',
          message: awsConfigured
            ? 'Self-test not run yet'
            : 'Missing AWS pricing credentials',
          checkedAt: null,
          latencyMs: null,
          details: {},
        },
        gcp: {
          configured: gcpConfigured,
          status: gcpConfigured ? 'unknown' : 'skipped',
          message: gcpConfigured
            ? 'Self-test not run yet'
            : 'Missing GCP pricing API key',
          checkedAt: null,
          latencyMs: null,
          details: {},
        },
      },
    };
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
      appLogger.info('financial.live_pricing.source.cost_explorer', {
        provider: resolution.provider,
        kind: resolution.kind,
        monthlyCostUsd: Number(observedMonthlyCostUsd.toFixed(4)),
      });
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

    let fallbackReason: LivePricingFallbackReason = 'no_live_match';
    try {
      appLogger.info('financial.live_pricing.fetch_attempt', {
        provider: resolution.provider,
        kind: resolution.kind,
        metadataKeys: metadataDebugKeys(metadata),
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
        appLogger.info('financial.live_pricing.source.api_live', {
          provider: resolution.provider,
          kind: resolution.kind,
          monthlyCostUsd: Number(liveMonthlyCostUsd.toFixed(4)),
        });
        const result = buildPricingResult({
          monthlyCostUsd: liveMonthlyCostUsd,
          source: 'pricing-api',
          currency,
          confidence: 0.88,
          note: 'Live cloud pricing API',
        });
        this.cache.set(cacheKey, { result, expiresAt: now + this.cacheTtlMs });
        return result;
      }
      appLogger.warn('financial.live_pricing.no_live_match', {
        provider: resolution.provider,
        kind: resolution.kind,
        metadataKeys: metadataDebugKeys(metadata),
      });
    } catch (error) {
      fallbackReason = 'error';
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
      fallbackReason,
    });
    appLogger.info('financial.live_pricing.source.static', {
      provider: resolution.provider,
      kind: resolution.kind,
      monthlyCostUsd: Number(fallback.monthlyCostUsd.toFixed(4)),
      fallbackReason,
    });
    this.cache.set(cacheKey, { result: fallback, expiresAt: now + this.cacheTtlMs });
    return fallback;
  }

  getConnectivityStatus(): PricingConnectivityStatus {
    return JSON.parse(JSON.stringify(this.connectivityStatus)) as PricingConnectivityStatus;
  }

  async runConnectivitySelfTest(): Promise<PricingConnectivityStatus> {
    const checkedAt = new Date().toISOString();
    const azureUrl =
      "https://prices.azure.com/api/retail/prices?%24filter=serviceName%20eq%20%27Virtual%20Machines%27&%24top=1";

    let azureStatus: PricingConnectivityProviderStatus = {
      configured: true,
      status: 'unknown',
      message: 'Self-test pending',
      checkedAt,
      latencyMs: null,
      details: {},
    };

    const azureStartedAt = Date.now();
    try {
      const response = await withTimeout(fetch(azureUrl), this.requestTimeoutMs);
      const latencyMs = Date.now() - azureStartedAt;
      if (!response.ok) {
        azureStatus = {
          configured: true,
          status: 'failed',
          message: `HTTP ${response.status}`,
          checkedAt,
          latencyMs,
          details: { status: response.status },
        };
        appLogger.warn('pricing.selftest.azure.failed', {
          status: response.status,
        });
      } else {
        const payload = (await response.json()) as { Items?: unknown[] };
        const itemCount = Array.isArray(payload.Items) ? payload.Items.length : 0;
        if (itemCount > 0) {
          azureStatus = {
            configured: true,
            status: 'ok',
            message: 'Connectivity OK',
            checkedAt,
            latencyMs,
            details: { itemCount },
          };
          appLogger.info('pricing.selftest.azure.ok', { itemCount });
        } else {
          azureStatus = {
            configured: true,
            status: 'failed',
            message: 'Empty response',
            checkedAt,
            latencyMs,
            details: { itemCount },
          };
          appLogger.warn('pricing.selftest.azure.empty', { itemCount });
        }
      }
    } catch (error) {
      azureStatus = {
        configured: true,
        status: 'failed',
        message: error instanceof Error ? error.message : 'unknown_error',
        checkedAt,
        latencyMs: Date.now() - azureStartedAt,
        details: {},
      };
      appLogger.error('pricing.selftest.azure.failed', {
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    }

    const awsAccessKey = String(process.env.AWS_PRICING_ACCESS_KEY_ID || '').trim();
    const awsSecretKey = String(process.env.AWS_PRICING_SECRET_ACCESS_KEY || '').trim();
    const awsConfigured = Boolean(awsAccessKey && awsSecretKey);
    let awsStatus: PricingConnectivityProviderStatus = {
      configured: awsConfigured,
      status: 'unknown',
      message: 'Self-test pending',
      checkedAt,
      latencyMs: null,
      details: {},
    };
    if (!awsConfigured) {
      awsStatus = {
        configured: false,
        status: 'skipped',
        message: 'Missing AWS pricing credentials',
        checkedAt,
        latencyMs: null,
        details: {},
      };
      appLogger.info('pricing.selftest.aws.skipped', {
        reason: 'missing_credentials',
      });
    } else {
      const awsStartedAt = Date.now();
      try {
        const explicitSelfTestRegion = String(process.env.AWS_PRICING_SELFTEST_REGION || '')
          .trim()
          .toLowerCase();
        const configuredPricingRegion = String(process.env.AWS_PRICING_REGION || '')
          .trim()
          .toLowerCase();
        const regionCandidates = Array.from(
          new Set(
            [
              explicitSelfTestRegion,
              configuredPricingRegion,
              'eu-west-3',
              'us-east-1',
            ].filter((candidate) => candidate.length > 0),
          ),
        );

        let winning:
          | Awaited<ReturnType<typeof getAwsEc2MonthlyPriceUsdWithDiagnostics>>
          | null = null;
        let lastDiagnostics:
          | Awaited<ReturnType<typeof getAwsEc2MonthlyPriceUsdWithDiagnostics>>['diagnostics']
          | null = null;
        const attemptErrors: Array<{ region: string; error: string }> = [];

        for (const regionCandidate of regionCandidates) {
          try {
            const attempt = await withTimeout(
              getAwsEc2MonthlyPriceUsdWithDiagnostics({
                instanceType: 't3.micro',
                region: regionCandidate,
              }),
              this.requestTimeoutMs,
            );
            lastDiagnostics = attempt.diagnostics;
            if (
              Number.isFinite(attempt.monthlyCostUsd) &&
              Number(attempt.monthlyCostUsd) > 0
            ) {
              winning = attempt;
              break;
            }
          } catch (error) {
            attemptErrors.push({
              region: regionCandidate,
              error: error instanceof Error ? error.message : 'unknown_error',
            });
          }
        }

        const monthlyCost = winning?.monthlyCostUsd ?? null;
        const selectedDiagnostics = winning?.diagnostics ?? lastDiagnostics;

        if (Number.isFinite(monthlyCost) && Number(monthlyCost) > 0) {
          awsStatus = {
            configured: true,
            status: 'ok',
            message: 'Connectivity OK',
            checkedAt,
            latencyMs: Date.now() - awsStartedAt,
            details: {
              monthlyCostUsd: Number(Number(monthlyCost).toFixed(4)),
              region: selectedDiagnostics?.region ?? null,
              location: selectedDiagnostics?.location ?? null,
              filters: selectedDiagnostics?.filters ?? [],
              rawCount: selectedDiagnostics?.rawCount ?? 0,
              parsedEntries: selectedDiagnostics?.parsedEntries ?? 0,
              scannedDimensions: selectedDiagnostics?.scannedDimensions ?? 0,
              matchedHourlyDimensions: selectedDiagnostics?.matchedHourlyDimensions ?? 0,
              unitsSeen: selectedDiagnostics?.unitsSeen ?? [],
              triedRegions: regionCandidates,
            },
          };
          appLogger.info('pricing.selftest.aws.ok', {
            monthlyCostUsd: Number(Number(monthlyCost).toFixed(4)),
            region: selectedDiagnostics?.region ?? null,
            location: selectedDiagnostics?.location ?? null,
            rawCount: selectedDiagnostics?.rawCount ?? 0,
          });
        } else {
          const noRows = (selectedDiagnostics?.rawCount ?? 0) === 0;
          const noPrice = (selectedDiagnostics?.scannedDimensions ?? 0) > 0;
          awsStatus = {
            configured: true,
            status: 'failed',
            message: noRows
              ? 'No pricing rows returned for self-test filters'
              : noPrice
                ? 'Pricing rows returned but no pricePerUnit detected'
                : 'Empty pricing response',
            checkedAt,
            latencyMs: Date.now() - awsStartedAt,
            details: {
              monthlyCostUsd: monthlyCost,
              region: selectedDiagnostics?.region ?? null,
              location: selectedDiagnostics?.location ?? null,
              filters: selectedDiagnostics?.filters ?? [],
              rawCount: selectedDiagnostics?.rawCount ?? 0,
              parsedEntries: selectedDiagnostics?.parsedEntries ?? 0,
              scannedDimensions: selectedDiagnostics?.scannedDimensions ?? 0,
              matchedHourlyDimensions: selectedDiagnostics?.matchedHourlyDimensions ?? 0,
              unitsSeen: selectedDiagnostics?.unitsSeen ?? [],
              triedRegions: regionCandidates,
              attemptErrors,
            },
          };
          appLogger.warn('pricing.selftest.aws.empty', {
            monthlyCostUsd: monthlyCost,
            region: selectedDiagnostics?.region ?? null,
            location: selectedDiagnostics?.location ?? null,
            rawCount: selectedDiagnostics?.rawCount ?? 0,
            scannedDimensions: selectedDiagnostics?.scannedDimensions ?? 0,
            triedRegions: regionCandidates,
          });
        }
      } catch (error) {
        awsStatus = {
          configured: true,
          status: 'failed',
          message: error instanceof Error ? error.message : 'unknown_error',
          checkedAt,
          latencyMs: Date.now() - awsStartedAt,
          details: {},
        };
        appLogger.warn('pricing.selftest.aws.failed', {
          error: error instanceof Error ? error.message : 'unknown_error',
        });
      }
    }

    const gcpConfigured = Boolean(String(process.env.GCP_PRICING_API_KEY || '').trim());
    let gcpStatus: PricingConnectivityProviderStatus = {
      configured: gcpConfigured,
      status: 'unknown',
      message: 'Self-test pending',
      checkedAt,
      latencyMs: null,
      details: {},
    };
    if (!gcpConfigured) {
      gcpStatus = {
        configured: false,
        status: 'skipped',
        message: 'Missing GCP pricing API key',
        checkedAt,
        latencyMs: null,
        details: {},
      };
      appLogger.info('pricing.selftest.gcp.skipped', {
        reason: 'missing_api_key',
      });
    } else {
      const gcpStartedAt = Date.now();
      try {
        const monthlyCost = await withTimeout(
          getGcpComputeMonthlyPriceUsd({
            machineType: 'n1-standard-1',
            zone: 'europe-west1-b',
          }),
          this.requestTimeoutMs,
        );
        if (Number.isFinite(monthlyCost) && Number(monthlyCost) > 0) {
          gcpStatus = {
            configured: true,
            status: 'ok',
            message: 'Connectivity OK',
            checkedAt,
            latencyMs: Date.now() - gcpStartedAt,
            details: {
              monthlyCostUsd: Number(Number(monthlyCost).toFixed(4)),
            },
          };
          appLogger.info('pricing.selftest.gcp.ok', {
            monthlyCostUsd: Number(Number(monthlyCost).toFixed(4)),
          });
        } else {
          gcpStatus = {
            configured: true,
            status: 'failed',
            message: 'Empty pricing response',
            checkedAt,
            latencyMs: Date.now() - gcpStartedAt,
            details: {
              monthlyCostUsd: monthlyCost,
            },
          };
          appLogger.warn('pricing.selftest.gcp.empty', {
            monthlyCostUsd: monthlyCost,
          });
        }
      } catch (error) {
        gcpStatus = {
          configured: true,
          status: 'failed',
          message: error instanceof Error ? error.message : 'unknown_error',
          checkedAt,
          latencyMs: Date.now() - gcpStartedAt,
          details: {},
        };
        appLogger.warn('pricing.selftest.gcp.failed', {
          error: error instanceof Error ? error.message : 'unknown_error',
        });
      }
    }

    this.connectivityStatus = {
      checkedAt,
      requestTimeoutMs: this.requestTimeoutMs,
      providers: {
        azure: azureStatus,
        aws: awsStatus,
        gcp: gcpStatus,
      },
    };

    return this.getConnectivityStatus();
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
        confidence: 0.6,
        note: staticEstimate.source,
      });
    }

    // Ultimate deterministic fallback for unknown services.
    const fallbackUsd = toPositiveNumber(process.env.DEFAULT_MONTHLY_COST_USD) ?? 50;
    return buildPricingResult({
      monthlyCostUsd: fallbackUsd,
      source: 'static-table',
      currency,
      confidence: 0.6,
      note: 'Static fallback default',
    });
  }
}

export const cloudPricingService = new CloudPricingService();
