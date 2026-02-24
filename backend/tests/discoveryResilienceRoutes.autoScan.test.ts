import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import discoveryResilienceRoutes from '../src/routes/discoveryResilienceRoutes.ts';
import { discoveryQueue } from '../src/queues/discoveryQueue.ts';
import prisma from '../src/prismaClient.ts';

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

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = 'tenant-auto-scan';
    req.apiRole = 'ADMIN';
    req.apiKeyId = 'api-key-1';
    next();
  });
  app.use('/discovery-resilience', discoveryResilienceRoutes);
  return app;
}

test('POST /discovery-resilience/auto-scan scans only valid configured providers', async (t) => {
  const originalSecret = process.env.DISCOVERY_SECRET;
  process.env.DISCOVERY_SECRET = 'test-secret';

  const discoveryJobDelegate = ((prisma as any).discoveryJob ||= {});
  const discoveryScanAuditDelegate = ((prisma as any).discoveryScanAudit ||= {});
  const originalCreate = discoveryJobDelegate.create;
  const originalUpdateMany = discoveryJobDelegate.updateMany;
  const originalQueueAdd = discoveryQueue.add;
  const originalAuditCreateMany = discoveryScanAuditDelegate.createMany;

  const createdJobs: any[] = [];
  discoveryJobDelegate.create = async ({ data }: any) => {
    createdJobs.push(data);
    return {
      id: 'job-auto-1',
      ...data,
      resultSummary: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
    };
  };
  discoveryJobDelegate.updateMany = async () => ({ count: 1 });
  discoveryScanAuditDelegate.createMany = async () => ({ count: 0 });
  discoveryQueue.add = async () => ({ id: 'queue-job-1' } as any);

  t.after(async () => {
    discoveryJobDelegate.create = originalCreate;
    discoveryJobDelegate.updateMany = originalUpdateMany;
    discoveryScanAuditDelegate.createMany = originalAuditCreateMany;
    discoveryQueue.add = originalQueueAdd;
    await discoveryQueue.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    if (originalSecret === undefined) delete process.env.DISCOVERY_SECRET;
    else process.env.DISCOVERY_SECRET = originalSecret;
  });

  const app = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/discovery-resilience/auto-scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        providers: [
          {
            type: 'aws',
            credentials: {
              accessKeyId: 'AKIA_TEST',
              secretAccessKey: 'secret-test',
            },
            regions: ['eu-west-1'],
          },
          {
            type: 'azure',
            credentials: {
              tenantId: 'tenant-only',
            },
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.scannedProviders, ['aws']);
    assert.equal(payload.ignoredProviders.length, 1);
    assert.equal(payload.ignoredProviders[0]?.provider, 'azure');
    assert.equal(payload.jobId, 'job-auto-1');
  });

  assert.equal(createdJobs.length, 1);
  const parameters = JSON.parse(createdJobs[0].parameters);
  assert.deepEqual(parameters.cloudProviders, ['aws']);
  assert.equal(parameters.ignoredProviders[0]?.provider, 'azure');
});

test('GET /discovery-resilience/scan-jobs/:jobId exposes scanned and ignored providers', async (t) => {
  const discoveryJobDelegate = ((prisma as any).discoveryJob ||= {});
  const originalFindFirst = discoveryJobDelegate.findFirst;

  discoveryJobDelegate.findFirst = async ({ where }: any) => {
    if (where.id !== 'job-auto-2') return null;
    return {
      id: 'job-auto-2',
      status: 'COMPLETED',
      progress: 100,
      parameters: JSON.stringify({
        cloudProviders: ['aws'],
        ignoredProviders: [{ provider: 'gcp', reason: 'missing credentials' }],
      }),
      resultSummary: JSON.stringify({
        discoveredResources: 12,
        discoveredFlows: 3,
        warnings: ['aws: AccessDenied'],
      }),
      errorMessage: null,
      startedAt: null,
      completedAt: new Date('2026-02-20T10:00:00.000Z'),
    };
  };

  t.after(() => {
    discoveryJobDelegate.findFirst = originalFindFirst;
  });

  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/discovery-resilience/scan-jobs/job-auto-2`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.scannedProviders, ['aws']);
    assert.equal(payload.ignoredProviders.length, 1);
    assert.equal(payload.failedProviders[0], 'aws');
    const skippedAdapter = payload.adapters.find((adapter: any) => adapter.provider === 'gcp');
    assert.equal(skippedAdapter?.status, 'skipped');
  });
});
