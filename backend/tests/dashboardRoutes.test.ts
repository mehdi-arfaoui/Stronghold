import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import dashboardRoutes from '../src/routes/dashboardRoutes.ts';
import prisma from '../src/prismaClient.ts';
import {
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardLayoutItem,
} from '../src/constants/dashboardWidgets.ts';

type DashboardConfigDelegate = {
  findUnique?: (...args: any[]) => Promise<unknown>;
  upsert?: (...args: any[]) => Promise<unknown>;
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).tenantId = 'tenant-1';
    (req as any).apiRole = 'READER';
    (req as any).user = {
      id: 'user-1',
      role: 'ADMIN',
      email: 'user@example.com',
      tenantId: 'tenant-1',
    };
    next();
  });
  app.use('/dashboard', dashboardRoutes);
  return app;
}

async function withServer(app: express.Express, handler: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'string' ? 0 : (address?.port ?? 0);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function getDashboardConfigDelegate() {
  const delegate = (prisma as any).dashboardConfig as DashboardConfigDelegate | undefined;
  if (delegate) return delegate;
  const created: DashboardConfigDelegate = {};
  (prisma as any).dashboardConfig = created;
  return created;
}

test('GET /dashboard/config returns default layout and scopes query by user + tenant', async () => {
  const app = createApp();
  const delegate = getDashboardConfigDelegate();
  const originalFindUnique = delegate.findUnique;
  const calls: any[] = [];

  delegate.findUnique = async (args: any) => {
    calls.push(args);
    return null;
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/dashboard/config`);
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(payload, DEFAULT_DASHBOARD_LAYOUT);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].where.userId_organizationId, {
        userId: 'user-1',
        organizationId: 'tenant-1',
      });
    });
  } finally {
    delegate.findUnique = originalFindUnique;
  }
});

test('GET /dashboard/config filters obsolete widgets silently', async () => {
  const app = createApp();
  const delegate = getDashboardConfigDelegate();
  const originalFindUnique = delegate.findUnique;

  delegate.findUnique = async () => ({
    layout: [
      { widgetId: 'resilience-score', x: 0, y: 0, w: 4, h: 2 },
      { widgetId: 'legacy-widget', x: 0, y: 3, w: 4, h: 2 },
    ],
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/dashboard/config`);
      const payload = (await response.json()) as DashboardLayoutItem[];

      assert.equal(response.status, 200);
      assert.equal(payload.length, 1);
      assert.equal(payload[0]?.widgetId, 'resilience-score');
    });
  } finally {
    delegate.findUnique = originalFindUnique;
  }
});

test('GET /dashboard/config falls back to default when persisted layout is fully obsolete', async () => {
  const app = createApp();
  const delegate = getDashboardConfigDelegate();
  const originalFindUnique = delegate.findUnique;

  delegate.findUnique = async () => ({
    layout: [
      { widgetId: 'legacy-a', x: 0, y: 0, w: 4, h: 2 },
      { widgetId: 'legacy-b', x: 4, y: 0, w: 4, h: 2 },
    ],
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/dashboard/config`);
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(payload, DEFAULT_DASHBOARD_LAYOUT);
    });
  } finally {
    delegate.findUnique = originalFindUnique;
  }
});

test('PUT /dashboard/config rejects non-array layouts', async () => {
  const app = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/dashboard/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: 'invalid' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'Layout must be an array');
  });
});

test('PUT /dashboard/config validates widget ids and dimensions before persistence', async () => {
  const app = createApp();
  const delegate = getDashboardConfigDelegate();
  const originalUpsert = delegate.upsert;
  const upsertCalls: any[] = [];

  delegate.upsert = async (args: any) => {
    upsertCalls.push(args);
    return {
      id: 'config-1',
      userId: args.where.userId_organizationId.userId,
      organizationId: args.where.userId_organizationId.organizationId,
      layout: args.update.layout,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/dashboard/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout: [
            { widgetId: 'resilience-score', x: 0, y: 0, w: 4, h: 2 },
            { widgetId: 'resilience-score', x: 1, y: 0, w: 4, h: 2 },
            { widgetId: 'unknown-widget', x: 0, y: 0, w: 4, h: 2 },
            { widgetId: 'spof-count', x: -1, y: 0, w: 4, h: 2 },
            { widgetId: 'budget-dr', x: 0, y: 0, w: 13, h: 2 },
          ],
        }),
      });
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(upsertCalls.length, 1);
      assert.deepEqual(upsertCalls[0].where.userId_organizationId, {
        userId: 'user-1',
        organizationId: 'tenant-1',
      });

      assert.deepEqual(upsertCalls[0].update.layout, [
        { widgetId: 'resilience-score', x: 0, y: 0, w: 4, h: 2 },
      ]);
      assert.equal(Array.isArray(payload.layout), true);
      assert.equal(payload.layout.length, 1);
    });
  } finally {
    delegate.upsert = originalUpsert;
  }
});
