import IORedis from "ioredis";

export type CircuitBreakerState = {
  failures: number;
  openedAt: number | null;
};

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
let redisClient: IORedis | null = null;
const memoryStore = new Map<string, CircuitBreakerState>();

function shouldUseRedis() {
  return process.env.CIRCUIT_BREAKER_REDIS_ENABLED === "true" || Boolean(process.env.REDIS_URL);
}

function getRedisClient() {
  if (!shouldUseRedis()) {
    return null;
  }
  if (!redisClient) {
    redisClient = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  }
  return redisClient;
}

function getTenantKey(tenantId: string) {
  return `circuitbreaker:openai:${tenantId}`;
}

export async function readCircuitBreakerState(
  tenantId: string
): Promise<CircuitBreakerState> {
  const redis = getRedisClient();
  if (!redis) {
    return memoryStore.get(tenantId) ?? { failures: 0, openedAt: null };
  }

  try {
    const data = await redis.hgetall(getTenantKey(tenantId));
    if (!data || Object.keys(data).length === 0) {
      return { failures: 0, openedAt: null };
    }

    const failures = Number(data.failures ?? 0);
    const openedAt = data.openedAt ? Number(data.openedAt) : null;
    return {
      failures: Number.isFinite(failures) && failures >= 0 ? failures : 0,
      openedAt: Number.isFinite(openedAt ?? NaN) ? openedAt : null,
    };
  } catch (_err) {
    return memoryStore.get(tenantId) ?? { failures: 0, openedAt: null };
  }
}

export async function writeCircuitBreakerState(
  tenantId: string,
  state: CircuitBreakerState
) {
  const redis = getRedisClient();
  if (!redis) {
    memoryStore.set(tenantId, state);
    return;
  }

  try {
    const key = getTenantKey(tenantId);
    const payload: Record<string, string> = {
      failures: String(state.failures),
    };

    if (state.openedAt) {
      payload.openedAt = String(state.openedAt);
    }

    await redis.hset(key, payload);

    if (!state.openedAt) {
      await redis.hdel(key, "openedAt");
    }
  } catch (_err) {
    memoryStore.set(tenantId, state);
  }
}
