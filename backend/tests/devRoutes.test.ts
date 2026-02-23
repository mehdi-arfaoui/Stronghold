import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createDevRoutes } from '../src/routes/devRoutes.js';

type ScanResult = [string, string[]];

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

function createTestApp(router: express.Router, apiRole: string = 'ADMIN') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenantId = 'tenant-a';
    req.apiRole = apiRole;
    next();
  });
  app.use('/dev', router);
  return app;
}

test('POST /dev/clear-session-cache clears tenant-scoped redis keys in development', async () => {
  const keyMap = new Map<string, string[]>([
    ['financial:tenant-a:*', ['financial:tenant-a:ale:1', 'financial:tenant-a:summary:2']],
    ['classification:tenant-a:*', ['classification:tenant-a:hash-1']],
    ['circuitbreaker:openai:tenant-a', ['circuitbreaker:openai:tenant-a']],
    ['license:tenant-a', ['license:tenant-a']],
    ['session:tenant-a:*', []],
    ['session:*:tenant-a:*', ['session:web:tenant-a:token']],
  ]);

  const scanPatterns: string[] = [];
  let deletedKeys: string[] = [];

  const router = createDevRoutes({
    nodeEnv: 'development',
    getRedisClient: async () =>
      ({
        scan: async (
          _cursor: string,
          _matchToken: string,
          pattern: string,
          _countToken: string,
          _count: string,
        ): Promise<ScanResult> => {
          scanPatterns.push(pattern);
          return ['0', keyMap.get(pattern) ?? []];
        },
        del: async (...keys: string[]) => {
          deletedKeys = keys;
          return keys.length;
        },
      }) as any,
  });

  const app = createTestApp(router);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/dev/clear-session-cache`, { method: 'POST' });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      success: boolean;
      tenantId: string;
      clearedKeys: number;
      patterns: string[];
      matchedKeys: string[];
    };

    assert.equal(body.success, true);
    assert.equal(body.tenantId, 'tenant-a');
    assert.equal(body.patterns.length, 6);
    assert.equal(body.clearedKeys, 6);
    assert.equal(new Set(body.matchedKeys).size, 6);
  });

  assert.equal(scanPatterns.length, 6);
  assert.equal(new Set(scanPatterns).size, 6);
  assert.equal(new Set(deletedKeys).size, 6);
});

test('POST /dev/clear-session-cache is disabled in production', async () => {
  let redisResolved = false;
  const router = createDevRoutes({
    nodeEnv: 'production',
    getRedisClient: async () => {
      redisResolved = true;
      return {
        scan: async () => ['0', []],
        del: async () => 0,
      } as any;
    },
  });
  const app = createTestApp(router);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/dev/clear-session-cache`, { method: 'POST' });
    assert.equal(response.status, 404);
  });

  assert.equal(redisResolved, false);
});
