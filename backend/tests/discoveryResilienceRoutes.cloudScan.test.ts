import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { spawn } from 'node:child_process';

import discoveryResilienceRoutes, {
  cloudScanAdapters,
  cloudScanIngestor,
} from '../src/routes/discoveryResilienceRoutes.ts';
import { discoveryQueue } from '../src/queues/discoveryQueue.ts';
import prisma from '../src/prismaClient.ts';

test.after(async () => {
  await discoveryQueue.close().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
});

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

async function runCurl(binary: string, args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = 'tenant-cloud-scan';
    req.apiRole = 'ADMIN';
    req.apiKeyId = 'api-key-cloud-scan';
    next();
  });
  app.use('/discovery-resilience', discoveryResilienceRoutes);
  app.use('/api/discovery-resilience', discoveryResilienceRoutes);
  return app;
}

test('POST /discovery-resilience/cloud-scan returns partial 200 and ingests successful providers', async (t) => {
  const originalAws = cloudScanAdapters.aws;
  const originalAzure = cloudScanAdapters.azure;
  const originalGcp = cloudScanAdapters.gcp;
  const originalIngest = cloudScanIngestor.ingest;
  let ingestArgs: {
    tenantId: string;
    resources: Array<{ externalId: string }>;
    flows: unknown[];
    provider: string;
    inferDependencies: boolean;
  } | null = null;

  (cloudScanAdapters as any).aws = async () => {
    throw new Error('AccessDeniedException');
  };
  (cloudScanAdapters as any).azure = async () => ({
    resources: [
      {
        source: 'azure',
        externalId: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1',
        name: 'vm-1',
        kind: 'infra',
        type: 'AZURE_VM',
        metadata: { region: 'westeurope' },
      },
    ],
    flows: [],
    warnings: [],
  });
  (cloudScanAdapters as any).gcp = async () => ({ resources: [], flows: [], warnings: [] });
  (cloudScanIngestor as any).ingest = async (
    _prisma: unknown,
    tenantId: string,
    resources: Array<{ externalId: string }>,
    flows: unknown[],
    provider: string,
    options: { inferDependencies?: boolean }
  ) => {
    ingestArgs = {
      tenantId,
      resources,
      flows,
      provider,
      inferDependencies: options.inferDependencies !== false,
    };
    return {
      provider,
      scannedAt: new Date('2026-02-24T12:00:00.000Z'),
      totalNodes: resources.length,
      totalEdges: flows.length,
      nodesCreated: resources.length,
      nodesUpdated: 0,
      nodesRemoved: 0,
      edgesCreated: flows.length,
      edgesUpdated: 0,
      edgesRemoved: 0,
    };
  };

  t.after(async () => {
    (cloudScanAdapters as any).aws = originalAws;
    (cloudScanAdapters as any).azure = originalAzure;
    (cloudScanAdapters as any).gcp = originalGcp;
    (cloudScanIngestor as any).ingest = originalIngest;
  });

  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/discovery-resilience/cloud-scan`, {
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
              tenantId: 'tenant-1',
              clientId: 'client-1',
              clientSecret: 'secret-1',
              subscriptionId: 'sub-1',
            },
          },
          {
            type: 'gcp',
            credentials: {
              projectId: 'project-1',
            },
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.partial, true);
    assert.equal(payload.success, false);
    assert.deepEqual(payload.scannedProviders, ['azure']);
    assert.deepEqual(payload.failedProviders, ['aws']);
    assert.equal(payload.ignoredProviders.length, 1);
    assert.equal(payload.ignoredProviders[0]?.provider, 'gcp');
    assert.equal(payload.errors.length, 1);
    assert.equal(payload.errors[0]?.provider, 'aws');
    assert.equal(payload.errors[0]?.kind, 'aws-sdk');
    assert.equal(payload.summary.nodes, 1);
    assert.equal(payload.summary.providersScanned, 1);
  });

  assert.equal(ingestArgs?.tenantId, 'tenant-cloud-scan');
  assert.equal(ingestArgs?.resources.length, 1);
  assert.equal(ingestArgs?.provider, 'cloud-scan');
  assert.equal(ingestArgs?.inferDependencies, true);
});

test('POST /api/discovery-resilience/cloud-scan responds to curl', async (t) => {
  const originalAws = cloudScanAdapters.aws;
  const originalIngest = cloudScanIngestor.ingest;

  (cloudScanAdapters as any).aws = async () => ({
    resources: [
      {
        source: 'aws',
        externalId: 'i-curl-1',
        name: 'i-curl-1',
        kind: 'infra',
        type: 'EC2_INSTANCE',
      },
    ],
    flows: [],
    warnings: [],
  });
  (cloudScanIngestor as any).ingest = async (
    _prisma: unknown,
    _tenantId: string,
    resources: unknown[],
    flows: unknown[],
    provider: string
  ) => ({
    provider,
    scannedAt: new Date('2026-02-24T12:30:00.000Z'),
    totalNodes: resources.length,
    totalEdges: flows.length,
    nodesCreated: resources.length,
    nodesUpdated: 0,
    nodesRemoved: 0,
    edgesCreated: flows.length,
    edgesUpdated: 0,
    edgesRemoved: 0,
  });

  t.after(() => {
    (cloudScanAdapters as any).aws = originalAws;
    (cloudScanIngestor as any).ingest = originalIngest;
  });

  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const curlBinary = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const payload = JSON.stringify({
      providers: [
        {
          type: 'aws',
          credentials: {
            accessKeyId: 'AKIA_TEST',
            secretAccessKey: 'secret-test',
          },
          regions: ['us-east-1'],
        },
      ],
    });

    const result = await runCurl(curlBinary, [
      '-s',
      '-X',
      'POST',
      `${baseUrl}/api/discovery-resilience/cloud-scan`,
      '-H',
      'content-type: application/json',
      '-d',
      payload,
    ]);

    assert.equal(result.code, 0, result.stderr || 'curl failed');
    const response = JSON.parse(result.stdout || '{}');
    assert.equal(response.success, true);
    assert.equal(response.summary?.nodes, 1);
    assert.deepEqual(response.scannedProviders, ['aws']);
  });
});
