import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupportedCurrency } from '../../constants/market-financial-data.js';
import { CloudPricingService } from '../../services/pricing/cloudPricingService.js';
import type { PricingResult } from '../../services/pricing/pricingTypes.js';

type MutablePricingService = {
  cacheTtlMs: number;
  requestTimeoutMs: number;
  fetchLiveMonthlyCostUsd: (resolution: unknown) => Promise<number | null>;
  getStaticFallback: (resolution: unknown, currency: SupportedCurrency) => PricingResult;
};

function asMutable(service: CloudPricingService): MutablePricingService {
  return service as unknown as MutablePricingService;
}

function staticFallback(currency: SupportedCurrency, usd = 7): PricingResult {
  return {
    monthlyCost: usd,
    monthlyCostUsd: usd,
    source: 'static-table',
    sourceLabel: 'Table statique',
    confidence: 0.6,
    currency,
    note: 'test static fallback',
  };
}

test('CloudPricingService exposes 24h cache TTL and caches identical requests', async () => {
  const service = new CloudPricingService();
  const mutable = asMutable(service);
  assert.equal(mutable.cacheTtlMs, 24 * 60 * 60 * 1000);

  let liveCalls = 0;
  mutable.fetchLiveMonthlyCostUsd = async () => {
    liveCalls += 1;
    return 11;
  };

  const input = {
    nodeType: 'VM',
    provider: 'aws',
    metadata: { instanceType: 't3.micro', region: 'eu-west-3' },
    preferredCurrency: 'USD' as const,
  };

  const first = await service.getResourceMonthlyCost(input);
  const second = await service.getResourceMonthlyCost(input);

  assert.equal(first.source, 'pricing-api');
  assert.equal(second.source, 'pricing-api');
  assert.equal(liveCalls, 1);
});

test('CloudPricingService uses observed monthly cost before live API', async () => {
  const service = new CloudPricingService();
  const mutable = asMutable(service);
  let liveCalls = 0;
  mutable.fetchLiveMonthlyCostUsd = async () => {
    liveCalls += 1;
    return 999;
  };

  const result = await service.getResourceMonthlyCost({
    nodeType: 'VM',
    provider: 'aws',
    metadata: { realMonthlyCostUSD: 123.45 },
    preferredCurrency: 'USD',
  });

  assert.equal(result.source, 'cost-explorer');
  assert.equal(result.sourceLabel, 'Prix reel');
  assert.equal(result.monthlyCostUsd, 123.45);
  assert.equal(result.confidence, 0.95);
  assert.equal(liveCalls, 0);
});

test('CloudPricingService uses live pricing API when observed cost is missing', async () => {
  const service = new CloudPricingService();
  const mutable = asMutable(service);
  let staticCalls = 0;
  mutable.fetchLiveMonthlyCostUsd = async () => 33;
  mutable.getStaticFallback = (resolution, currency) => {
    void resolution;
    staticCalls += 1;
    return staticFallback(currency, 5);
  };

  const result = await service.getResourceMonthlyCost({
    nodeType: 'DATABASE',
    provider: 'aws',
    metadata: { dbInstanceClass: 'db.t3.micro', engine: 'PostgreSQL', region: 'eu-west-3' },
    preferredCurrency: 'USD',
  });

  assert.equal(result.source, 'pricing-api');
  assert.equal(result.sourceLabel, 'Prix API live');
  assert.equal(result.monthlyCostUsd, 33);
  assert.equal(result.confidence, 0.9);
  assert.equal(staticCalls, 0);
});

test('CloudPricingService falls back to static table when live pricing throws', async () => {
  const service = new CloudPricingService();
  const mutable = asMutable(service);
  let staticCalls = 0;

  mutable.fetchLiveMonthlyCostUsd = async () => {
    throw new Error('live pricing unavailable');
  };
  mutable.getStaticFallback = (resolution, currency) => {
    void resolution;
    staticCalls += 1;
    return staticFallback(currency, 19);
  };

  const result = await service.getResourceMonthlyCost({
    nodeType: 'UNKNOWN_SERVICE',
    provider: 'aws',
    metadata: {},
    preferredCurrency: 'USD',
  });

  assert.equal(result.source, 'static-table');
  assert.equal(result.sourceLabel, 'Table statique');
  assert.equal(result.monthlyCostUsd, 19);
  assert.equal(result.confidence, 0.6);
  assert.equal(staticCalls, 1);
});

test('CloudPricingService enforces timeout and falls back to static pricing', async () => {
  const service = new CloudPricingService();
  const mutable = asMutable(service);
  mutable.requestTimeoutMs = 25;

  mutable.fetchLiveMonthlyCostUsd = async () =>
    new Promise<number>((resolve) => {
      setTimeout(() => resolve(88), 200);
    });
  mutable.getStaticFallback = (resolution, currency) => {
    void resolution;
    return staticFallback(currency, 9);
  };

  const startedAt = Date.now();
  const result = await service.getResourceMonthlyCost({
    nodeType: 'CACHE',
    provider: 'aws',
    metadata: {},
    preferredCurrency: 'USD',
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.source, 'static-table');
  assert.equal(result.sourceLabel, 'Table statique');
  assert.equal(result.confidence, 0.6);
  assert.ok(elapsedMs < 150, `expected timeout fallback to be fast, got ${elapsedMs}ms`);
});

test('CloudPricingService exposes pricing connectivity status for health endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const originalAwsAccess = process.env.AWS_PRICING_ACCESS_KEY_ID;
  const originalAwsSecret = process.env.AWS_PRICING_SECRET_ACCESS_KEY;
  const originalGcpApiKey = process.env.GCP_PRICING_API_KEY;

  process.env.AWS_PRICING_ACCESS_KEY_ID = '';
  process.env.AWS_PRICING_SECRET_ACCESS_KEY = '';
  process.env.GCP_PRICING_API_KEY = '';

  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ Items: [{}] }),
    }) as any) as typeof fetch;

  try {
    const service = new CloudPricingService();
    const initial = service.getConnectivityStatus();
    assert.equal(initial.providers.azure.status, 'unknown');

    const status = await service.runConnectivitySelfTest();
    assert.equal(status.providers.azure.status, 'ok');
    assert.equal(status.providers.aws.status, 'skipped');
    assert.equal(status.providers.gcp.status, 'skipped');
    assert.ok(typeof status.checkedAt === 'string' && status.checkedAt.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.AWS_PRICING_ACCESS_KEY_ID = originalAwsAccess;
    process.env.AWS_PRICING_SECRET_ACCESS_KEY = originalAwsSecret;
    process.env.GCP_PRICING_API_KEY = originalGcpApiKey;
  }
});

