import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import businessFlowRoutes from '../src/routes/businessFlowRoutes.js';
import prisma from '../src/prismaClient.js';

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

test('GET /business-flows applies tenant isolation in Prisma query', async () => {
  const originalFindMany = prisma.businessFlow.findMany;
  const originalProfileFindUnique = prisma.organizationProfile.findUnique;
  let capturedWhere: unknown = null;

  prisma.businessFlow.findMany = (async (args: any) => {
    capturedWhere = args?.where;
    return [
      {
        id: 'flow-1',
        tenantId: 'tenant-x',
        name: 'Customer Payment',
        description: null,
        category: 'revenue',
        annualRevenue: null,
        transactionsPerHour: null,
        revenuePerTransaction: null,
        estimatedCostPerHour: 1000,
        calculatedCostPerHour: 1000,
        costCalculationMethod: 'direct_estimate',
        peakHoursMultiplier: 1.5,
        peakHoursStart: null,
        peakHoursEnd: null,
        operatingDaysPerWeek: 5,
        operatingHoursPerDay: 10,
        slaUptimePercent: null,
        slaPenaltyPerHour: null,
        slaPenaltyFlat: null,
        contractualRTO: null,
        estimatedCustomerChurnPerHour: null,
        customerLifetimeValue: null,
        reputationImpactCategory: null,
        source: 'manual',
        aiConfidence: null,
        validatedByUser: true,
        validatedAt: null,
        mutualExclusionGroup: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        flowNodes: [],
      },
    ] as any;
  }) as any;
  prisma.organizationProfile.findUnique = (async () => ({ customCurrency: 'EUR' })) as any;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = 'tenant-x';
    req.apiRole = 'ADMIN';
    next();
  });
  app.use('/business-flows', businessFlowRoutes);

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/business-flows`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as Array<{
        id: string;
        downtimeCostPerHour: number | null;
        downtimeCostSource: string;
        downtimeCostSourceLabel: string;
        contributingServices: unknown[];
      }>;
      assert.equal(body.length, 1);
      assert.equal(body[0]?.id, 'flow-1');
      assert.equal(body[0]?.downtimeCostPerHour, null);
      assert.equal(body[0]?.downtimeCostSource, 'not_configured');
      assert.equal(typeof body[0]?.downtimeCostSourceLabel, 'string');
      assert.ok(Array.isArray(body[0]?.contributingServices));
    });

    assert.deepEqual(capturedWhere, { tenantId: 'tenant-x' });
  } finally {
    prisma.businessFlow.findMany = originalFindMany;
    prisma.organizationProfile.findUnique = originalProfileFindUnique;
  }
});

test('POST /business-flows/validate-batch validates only pending flows within tenant scope', async () => {
  const originalFindMany = prisma.businessFlow.findMany;
  const originalUpdateMany = prisma.businessFlow.updateMany;

  let capturedFindManyWhere: unknown = null;
  let capturedUpdateWhere: unknown = null;
  let capturedUpdateData: unknown = null;

  prisma.businessFlow.findMany = (async (args: any) => {
    capturedFindManyWhere = args?.where;
    return [{ id: 'flow-1' }, { id: 'flow-2' }] as any;
  }) as any;

  prisma.businessFlow.updateMany = (async (args: any) => {
    capturedUpdateWhere = args?.where;
    capturedUpdateData = args?.data;
    return { count: 2 } as any;
  }) as any;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = 'tenant-x';
    req.apiRole = 'OPERATOR';
    next();
  });
  app.use('/business-flows', businessFlowRoutes);

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/business-flows/validate-batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ['flow-1', 'flow-2', 'flow-2'] }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { validatedCount: number; validatedIds: string[] };
      assert.equal(body.validatedCount, 2);
      assert.deepEqual(body.validatedIds, ['flow-1', 'flow-2']);
    });

    assert.deepEqual(capturedFindManyWhere, {
      tenantId: 'tenant-x',
      validatedByUser: false,
      id: { in: ['flow-1', 'flow-2'] },
    });
    assert.deepEqual(capturedUpdateWhere, {
      tenantId: 'tenant-x',
      id: { in: ['flow-1', 'flow-2'] },
    });
    assert.ok(capturedUpdateData && typeof capturedUpdateData === 'object');
    assert.equal((capturedUpdateData as Record<string, unknown>).validatedByUser, true);
  } finally {
    prisma.businessFlow.findMany = originalFindMany;
    prisma.businessFlow.updateMany = originalUpdateMany;
  }
});
