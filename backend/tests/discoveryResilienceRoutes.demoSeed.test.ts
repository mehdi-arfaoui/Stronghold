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

test('POST /discovery-resilience/seed-demo is blocked in production', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowDemoSeed = process.env.ALLOW_DEMO_SEED;

  process.env.NODE_ENV = 'production';
  process.env.ALLOW_DEMO_SEED = 'true';

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = 'tenant-prod-block';
    req.apiRole = 'ADMIN';
    next();
  });
  app.use('/discovery-resilience', discoveryResilienceRoutes);

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/discovery-resilience/seed-demo`, {
        method: 'POST',
      });

      assert.equal(response.status, 403);
      const payload = await response.json();
      assert.equal(payload.environment, 'production');
      assert.equal(payload.mode, 'production');
      assert.equal(typeof payload.error, 'string');
      assert.ok(payload.error.toLowerCase().includes('disabled'));
    });
  } finally {
    await discoveryQueue.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);

    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;

    if (originalAllowDemoSeed === undefined) delete process.env.ALLOW_DEMO_SEED;
    else process.env.ALLOW_DEMO_SEED = originalAllowDemoSeed;
  }
});
