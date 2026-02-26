import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import financialRoutes from '../src/routes/financialRoutes.js';
import {
  cloudPricingService,
  type PricingConnectivityStatus,
} from '../src/services/pricing/cloudPricingService.js';

async function withServer(app: express.Express, handler: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'string' ? 0 : address?.port || 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function mockStatus(checkedAt: string): PricingConnectivityStatus {
  return {
    checkedAt,
    requestTimeoutMs: 5000,
    providers: {
      azure: {
        configured: true,
        status: 'ok',
        message: 'Connectivity OK',
        checkedAt,
        latencyMs: 123,
        details: { itemCount: 1 },
      },
      aws: {
        configured: false,
        status: 'skipped',
        message: 'Missing AWS pricing credentials',
        checkedAt,
        latencyMs: null,
        details: {},
      },
      gcp: {
        configured: false,
        status: 'skipped',
        message: 'Missing GCP pricing API key',
        checkedAt,
        latencyMs: null,
        details: {},
      },
    },
  };
}

test('GET /financial/pricing/health exposes connectivity snapshot and supports refresh', async () => {
  const originalGet = cloudPricingService.getConnectivityStatus.bind(cloudPricingService);
  const originalRun = cloudPricingService.runConnectivitySelfTest.bind(cloudPricingService);
  const runCalls: string[] = [];
  const getCalls: string[] = [];
  const baseCheckedAt = new Date().toISOString();

  (cloudPricingService as any).getConnectivityStatus = () => {
    getCalls.push('get');
    return mockStatus(baseCheckedAt);
  };
  (cloudPricingService as any).runConnectivitySelfTest = async () => {
    runCalls.push('run');
    return mockStatus(new Date().toISOString());
  };

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = 'tenant-pricing-health';
    req.apiRole = 'READER';
    next();
  });
  app.use('/financial', financialRoutes);

  try {
    await withServer(app, async (baseUrl) => {
      const snapshotResponse = await fetch(`${baseUrl}/financial/pricing/health`);
      assert.equal(snapshotResponse.status, 200);
      const snapshotBody = (await snapshotResponse.json()) as {
        refreshed: boolean;
        checkedByTenantId: string;
        providers: PricingConnectivityStatus['providers'];
      };
      assert.equal(snapshotBody.refreshed, false);
      assert.equal(snapshotBody.checkedByTenantId, 'tenant-pricing-health');
      assert.equal(snapshotBody.providers.azure.status, 'ok');
      assert.equal(getCalls.length, 1);
      assert.equal(runCalls.length, 0);

      const refreshResponse = await fetch(`${baseUrl}/financial/pricing/health?refresh=true`);
      assert.equal(refreshResponse.status, 200);
      const refreshBody = (await refreshResponse.json()) as {
        refreshed: boolean;
        checkedByTenantId: string;
        providers: PricingConnectivityStatus['providers'];
      };
      assert.equal(refreshBody.refreshed, true);
      assert.equal(refreshBody.checkedByTenantId, 'tenant-pricing-health');
      assert.equal(refreshBody.providers.azure.status, 'ok');
      assert.equal(runCalls.length, 1);
    });
  } finally {
    (cloudPricingService as any).getConnectivityStatus = originalGet;
    (cloudPricingService as any).runConnectivitySelfTest = originalRun;
  }
});

