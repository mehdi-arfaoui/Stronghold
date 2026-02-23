import { Router } from 'express';
import type { Redis } from 'ioredis';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { requireRole } from '../middleware/tenantMiddleware.js';
import { getRedis } from '../lib/redis.js';
import { appLogger } from '../utils/logger.js';

type RedisCacheClient = Pick<Redis, 'scan' | 'del'>;

type DevRoutesDependencies = {
  getRedisClient?: () => Promise<RedisCacheClient>;
  nodeEnv?: string;
};

type ClearCacheResult = {
  clearedKeys: number;
  matchedKeys: string[];
  patterns: string[];
};

const CACHE_PATTERNS_BY_TENANT: ReadonlyArray<(tenantId: string) => string> = [
  (tenantId) => `financial:${tenantId}:*`,
  (tenantId) => `classification:${tenantId}:*`,
  (tenantId) => `circuitbreaker:openai:${tenantId}`,
  (tenantId) => `license:${tenantId}`,
  (tenantId) => `session:${tenantId}:*`,
  (tenantId) => `session:*:${tenantId}:*`,
];

async function collectKeysByPattern(redis: RedisCacheClient, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';

  do {
    const [nextCursor, matched] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '200');
    cursor = nextCursor;
    if (matched.length > 0) {
      keys.push(...matched);
    }
  } while (cursor !== '0');

  return keys;
}

async function clearTenantCache(
  redis: RedisCacheClient,
  tenantId: string,
): Promise<ClearCacheResult> {
  const patterns = CACHE_PATTERNS_BY_TENANT.map((patternBuilder) => patternBuilder(tenantId));
  const matchedKeySet = new Set<string>();

  for (const pattern of patterns) {
    const keys = await collectKeysByPattern(redis, pattern);
    for (const key of keys) {
      matchedKeySet.add(key);
    }
  }

  const matchedKeys = Array.from(matchedKeySet);
  if (matchedKeys.length > 0) {
    await redis.del(...matchedKeys);
  }

  return {
    clearedKeys: matchedKeys.length,
    matchedKeys,
    patterns,
  };
}

export function createDevRoutes(deps: DevRoutesDependencies = {}) {
  const router = Router();
  const nodeEnv = deps.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const resolveRedisClient = deps.getRedisClient ?? (async () => getRedis());

  router.post('/clear-session-cache', requireRole('OPERATOR'), async (req: TenantRequest, res) => {
    if (isProduction) {
      return res.status(404).json({ error: 'Not found' });
    }

    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: 'Tenant not resolved' });
    }

    try {
      const redis = await resolveRedisClient();
      const result = await clearTenantCache(redis, tenantId);

      appLogger.info('dev.cache.cleared', {
        tenantId,
        clearedKeys: result.clearedKeys,
        patternsCount: result.patterns.length,
        nodeEnv,
      });

      return res.json({
        success: true,
        tenantId,
        environment: nodeEnv,
        clearedKeys: result.clearedKeys,
        patterns: result.patterns,
        matchedKeys: result.matchedKeys,
      });
    } catch (error) {
      appLogger.error('dev.cache.clear_failed', {
        tenantId,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
      return res.status(500).json({ error: 'Failed to clear Redis cache' });
    }
  });

  return router;
}

const devRoutes = createDevRoutes();

export default devRoutes;
