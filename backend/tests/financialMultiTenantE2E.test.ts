import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';
import Redis from 'ioredis';
import prisma from '../src/prismaClient.js';
import financialRoutes from '../src/routes/financialRoutes.js';
import businessFlowRoutes from '../src/routes/businessFlowRoutes.js';
import { tenantMiddleware } from '../src/middleware/tenantMiddleware.js';
import sharedRedisClient from '../src/lib/redis.js';

const DEPENDENTS_PER_TENANT = 4_200;
const CHUNK_SIZE = 500;

type TenantSetup = {
  tenantId: string;
  apiKey: string;
  criticalNodeId: string;
  flowNodeId: string;
};

type ApiResponse<T = unknown> = {
  status: number;
  body: T | null;
};

type OrgProfileInput = {
  sizeCategory: string;
  verticalSector: string;
  customCurrency: string;
};

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    void tenantMiddleware(req as any, res as any, next);
  });
  app.use('/business-flows', businessFlowRoutes);
  app.use('/financial', financialRoutes);
  return app;
}

async function withServer(app: express.Express, fn: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'string' ? 0 : (address?.port ?? 0);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function requestJson<T = unknown>(input: {
  baseUrl: string;
  apiKey: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  payload?: unknown;
}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'x-api-key': input.apiKey,
  };
  if (input.payload !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${input.baseUrl}${input.path}`, {
    method: input.method,
    headers,
    body: input.payload !== undefined ? JSON.stringify(input.payload) : undefined,
  });

  const rawBody = await response.text();
  if (!rawBody) {
    return { status: response.status, body: null };
  }

  try {
    return { status: response.status, body: JSON.parse(rawBody) as T };
  } catch {
    return { status: response.status, body: null };
  }
}

async function createInChunks<T>(values: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let index = 0; index < values.length; index += CHUNK_SIZE) {
    const chunk = values.slice(index, index + CHUNK_SIZE);
    await insert(chunk);
  }
}

async function seedTenantData(input: {
  tenantId: string;
  apiKey: string;
  profile: OrgProfileInput;
  label: string;
}): Promise<TenantSetup> {
  const criticalNodeId = `${input.tenantId}-critical-db`;
  const flowNodeId = `${input.tenantId}-payment-api`;

  await prisma.tenant.create({
    data: {
      id: input.tenantId,
      name: input.label,
      apiKey: input.apiKey,
    },
  });

  await prisma.organizationProfile.create({
    data: {
      tenantId: input.tenantId,
      sizeCategory: input.profile.sizeCategory,
      verticalSector: input.profile.verticalSector,
      customCurrency: input.profile.customCurrency,
    },
  });

  await prisma.infraNode.createMany({
    data: [
      {
        id: criticalNodeId,
        tenantId: input.tenantId,
        name: `${input.label} Critical DB`,
        type: 'DATABASE',
        provider: 'aws',
        region: 'eu-west-1',
        tags: {},
        metadata: {},
        isSPOF: true,
        criticalityScore: 0.95,
        redundancyScore: 0.1,
        suggestedRTO: 120,
        impactCategory: 'tier1_mission_critical',
      },
      {
        id: flowNodeId,
        tenantId: input.tenantId,
        name: `${input.label} Payment API`,
        type: 'API_GATEWAY',
        provider: 'aws',
        region: 'eu-west-1',
        tags: {},
        metadata: {},
        isSPOF: false,
        criticalityScore: 0.6,
        redundancyScore: 0.7,
      },
    ],
  });

  const dependentNodes = Array.from({ length: DEPENDENTS_PER_TENANT }, (_, index) => ({
    id: `${input.tenantId}-dep-${index}`,
    tenantId: input.tenantId,
    name: `${input.label} Dep ${index}`,
    type: 'APPLICATION',
    provider: 'aws',
    region: 'eu-west-1',
    tags: {},
    metadata: {},
    isSPOF: false,
    criticalityScore: 0.2,
    redundancyScore: 0.9,
  }));

  await createInChunks(dependentNodes, async (chunk) => {
    await prisma.infraNode.createMany({ data: chunk });
  });

  const dependentEdges = dependentNodes.map((node) => ({
    sourceId: node.id,
    targetId: criticalNodeId,
    type: 'DEPENDS_ON',
    tenantId: input.tenantId,
  }));

  await createInChunks(dependentEdges, async (chunk) => {
    await prisma.infraEdge.createMany({ data: chunk });
  });

  const report = await prisma.bIAReport2.create({
    data: {
      tenantId: input.tenantId,
      generatedAt: new Date(),
      summary: {},
    },
  });

  await prisma.bIAProcess2.create({
    data: {
      tenantId: input.tenantId,
      biaReportId: report.id,
      serviceNodeId: criticalNodeId,
      serviceName: `${input.label} Critical DB`,
      serviceType: 'DATABASE',
      impactCategory: 'tier1_mission_critical',
      criticalityScore: 0.95,
      recoveryTier: 1,
      dependencyChain: [],
      weakPoints: [],
      financialImpact: {},
      suggestedRTO: 120,
      validatedRTO: 120,
      suggestedRPO: 15,
      validatedRPO: 15,
      suggestedMTPD: 240,
      validatedMTPD: 240,
    },
  });

  return {
    tenantId: input.tenantId,
    apiKey: input.apiKey,
    criticalNodeId,
    flowNodeId,
  };
}

async function scanRedisKeys(client: Redis, pattern: string): Promise<string[]> {
  let cursor = '0';
  const keys: string[] = [];
  do {
    const [nextCursor, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

function summaryFingerprint(summary: any) {
  return {
    annualRisk: summary?.metrics?.annualRisk ?? null,
    potentialSavings: summary?.metrics?.potentialSavings ?? null,
    roiPercent: summary?.metrics?.roiPercent ?? null,
    paybackMonths: summary?.metrics?.paybackMonths ?? null,
    totalSPOFs: summary?.totals?.totalSPOFs ?? null,
    currency: summary?.currency ?? null,
    sizeCategory: summary?.organizationProfile?.sizeCategory ?? null,
    verticalSector: summary?.organizationProfile?.verticalSector ?? null,
  };
}

async function cleanupTenants(tenantIds: string[]) {
  const tenantFilter = { in: tenantIds };
  await prisma.auditLog.deleteMany({ where: { tenantId: tenantFilter } });
  await prisma.businessFlowNode.deleteMany({ where: { tenantId: tenantFilter } });
  await prisma.businessFlow.deleteMany({ where: { tenantId: tenantFilter } });
  await prisma.nodeFinancialOverride.deleteMany({ where: { tenantId: tenantFilter } });
  await prisma.bIAProcess2.deleteMany({ where: { tenantId: tenantFilter } });
  await prisma.bIAReport2.deleteMany({ where: { tenantId: tenantFilter } });
  await prisma.infraEdge.deleteMany({ where: { tenantId: tenantFilter } });
  await prisma.infraNode.deleteMany({ where: { tenantId: tenantFilter } });
  await prisma.organizationProfile.deleteMany({ where: { tenantId: tenantFilter } });
  await prisma.tenant.deleteMany({ where: { id: tenantFilter } });
}

test('E2E multi-tenant isolation for business flows and financial engine', async () => {
  const suffix = randomUUID().slice(0, 8);
  const tenantAId = `tenant-a-${suffix}`;
  const tenantBId = `tenant-b-${suffix}`;

  const tenantAApiKey = `e2e-key-a-${suffix}`;
  const tenantBApiKey = `e2e-key-b-${suffix}`;

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const redisClient = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });

  try {
    await redisClient.connect();
    await cleanupTenants([tenantAId, tenantBId]);

    const tenantA = await seedTenantData({
      tenantId: tenantAId,
      apiKey: tenantAApiKey,
      label: 'Tenant A',
      profile: {
        sizeCategory: 'midMarket', // ETI mapping
        verticalSector: 'banking_finance',
        customCurrency: 'EUR',
      },
    });

    const tenantB = await seedTenantData({
      tenantId: tenantBId,
      apiKey: tenantBApiKey,
      label: 'Tenant B',
      profile: {
        sizeCategory: 'smb', // PME mapping
        verticalSector: 'technology_saas',
        customCurrency: 'USD',
      },
    });

    const app = createTestApp();

    await withServer(app, async (baseUrl) => {
      // Setup: create flow "Paiement" on tenant A
      const createFlow = await requestJson<any>({
        baseUrl,
        apiKey: tenantA.apiKey,
        method: 'POST',
        path: '/business-flows',
        payload: {
          name: 'Paiement',
          category: 'revenue',
          annualRevenue: 2_400_000,
          source: 'manual',
        },
      });
      assert.equal(createFlow.status, 201);
      assert.ok(createFlow.body?.id);

      const flowId = String(createFlow.body?.id);
      const attachNode = await requestJson<any>({
        baseUrl,
        apiKey: tenantA.apiKey,
        method: 'POST',
        path: `/business-flows/${flowId}/nodes`,
        payload: {
          nodes: [
            {
              infraNodeId: tenantA.flowNodeId,
              orderIndex: 0,
              role: 'processing',
              isCritical: true,
              hasAlternativePath: false,
            },
          ],
        },
      });
      assert.equal(attachNode.status, 201);

      // Test 1: data isolation
      const tenantBFlows = await requestJson<any[]>({
        baseUrl,
        apiKey: tenantB.apiKey,
        method: 'GET',
        path: '/business-flows',
      });
      assert.equal(tenantBFlows.status, 200);
      assert.equal(Array.isArray(tenantBFlows.body), true);
      assert.equal((tenantBFlows.body || []).length, 0);

      const tenantBReadsATenantNode = await requestJson<any>({
        baseUrl,
        apiKey: tenantB.apiKey,
        method: 'GET',
        path: `/financial/node/${tenantA.flowNodeId}/flow-impact`,
      });
      assert.equal(tenantBReadsATenantNode.status, 404);

      const tenantBOwnFlowImpact = await requestJson<any>({
        baseUrl,
        apiKey: tenantB.apiKey,
        method: 'GET',
        path: `/financial/node/${tenantB.flowNodeId}/flow-impact`,
      });
      assert.equal(tenantBOwnFlowImpact.status, 200);
      assert.equal(tenantBOwnFlowImpact.body?.flowImpact?.nodeId, tenantB.flowNodeId);
      assert.equal((tenantBOwnFlowImpact.body?.flowImpact?.impactedFlows || []).length, 0);

      // Test 2: financial calculation isolation
      const aleA = await requestJson<any>({
        baseUrl,
        apiKey: tenantA.apiKey,
        method: 'POST',
        path: '/financial/calculate-ale',
        payload: {},
      });
      const aleB = await requestJson<any>({
        baseUrl,
        apiKey: tenantB.apiKey,
        method: 'POST',
        path: '/financial/calculate-ale',
        payload: {},
      });

      assert.equal(aleA.status, 200);
      assert.equal(aleB.status, 200);
      assert.notEqual(aleA.body?.totalALE, aleB.body?.totalALE);
      assert.equal(aleA.body?.orgProfile?.verticalSector, 'banking_finance');
      assert.equal(aleB.body?.orgProfile?.verticalSector, 'technology_saas');
      assert.equal(aleA.body?.orgProfile?.sizeCategory, 'midMarket');
      assert.equal(aleB.body?.orgProfile?.sizeCategory, 'smb');

      // Test 3: profile stability under alternating requests
      for (let index = 0; index < 10; index += 1) {
        const isTenantA = index % 2 === 0;
        const response = await requestJson<any>({
          baseUrl,
          apiKey: isTenantA ? tenantA.apiKey : tenantB.apiKey,
          method: 'GET',
          path: '/financial/org-profile',
        });
        assert.equal(response.status, 200);
        if (isTenantA) {
          assert.equal(response.body?.sizeCategory, 'midMarket');
          assert.equal(response.body?.verticalSector, 'banking_finance');
          assert.equal(response.body?.customCurrency, 'EUR');
        } else {
          assert.equal(response.body?.sizeCategory, 'smb');
          assert.equal(response.body?.verticalSector, 'technology_saas');
          assert.equal(response.body?.customCurrency, 'USD');
        }
      }

      // Test 4: cache invalidation must be tenant-isolated
      const summaryABefore = await requestJson<any>({
        baseUrl,
        apiKey: tenantA.apiKey,
        method: 'GET',
        path: '/financial/summary',
      });
      const summaryBBefore = await requestJson<any>({
        baseUrl,
        apiKey: tenantB.apiKey,
        method: 'GET',
        path: '/financial/summary',
      });
      assert.equal(summaryABefore.status, 200);
      assert.equal(summaryBBefore.status, 200);

      const keysABefore = await scanRedisKeys(redisClient, `financial:${tenantA.tenantId}:*`);
      const keysBBefore = await scanRedisKeys(redisClient, `financial:${tenantB.tenantId}:*`);
      assert.ok(keysABefore.length > 0);
      assert.ok(keysBBefore.length > 0);

      const updateTenantAProfile = await requestJson<any>({
        baseUrl,
        apiKey: tenantA.apiKey,
        method: 'PUT',
        path: '/financial/org-profile',
        payload: {
          sizeCategory: 'enterprise',
        },
      });
      assert.equal(updateTenantAProfile.status, 200);
      assert.equal(updateTenantAProfile.body?.sizeCategory, 'enterprise');

      const keysAAfterInvalidation = await scanRedisKeys(redisClient, `financial:${tenantA.tenantId}:*`);
      const keysBAfterInvalidation = await scanRedisKeys(redisClient, `financial:${tenantB.tenantId}:*`);
      assert.equal(keysAAfterInvalidation.length, 0);
      assert.equal(keysBAfterInvalidation.length, keysBBefore.length);

      const summaryAAfter = await requestJson<any>({
        baseUrl,
        apiKey: tenantA.apiKey,
        method: 'GET',
        path: '/financial/summary',
      });
      const summaryBAfter = await requestJson<any>({
        baseUrl,
        apiKey: tenantB.apiKey,
        method: 'GET',
        path: '/financial/summary',
      });
      assert.equal(summaryAAfter.status, 200);
      assert.equal(summaryBAfter.status, 200);

      assert.equal(summaryAAfter.body?.organizationProfile?.sizeCategory, 'enterprise');
      assert.notEqual(summaryAAfter.body?.metrics?.annualRisk, summaryABefore.body?.metrics?.annualRisk);

      assert.deepEqual(
        summaryFingerprint(summaryBAfter.body),
        summaryFingerprint(summaryBBefore.body),
      );
    });
  } finally {
    await cleanupTenants([tenantAId, tenantBId]);
    await scanRedisKeys(redisClient, `financial:${tenantAId}:*`).then(async (keys) => {
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    });
    await scanRedisKeys(redisClient, `financial:${tenantBId}:*`).then(async (keys) => {
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    });
    await redisClient.quit().catch(() => redisClient.disconnect());
    sharedRedisClient.disconnect();
    await prisma.$disconnect();
  }
});
