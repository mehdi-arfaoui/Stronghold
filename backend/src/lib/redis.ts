import { Redis, type RedisOptions } from 'ioredis';
import { appLogger } from '../utils/logger.js';
import { buildRedisConnectionOptions } from "../utils/redisConnection.js";

const connectionOptions: RedisOptions = buildRedisConnectionOptions();

export const redis = new Redis({
  ...connectionOptions,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => {
    if (times > 3) {
      return null; // Stop retrying
    }
    return Math.min(times * 200, 2000);
  },
});

// Handle connection events
redis.on('error', (err) => {
  appLogger.error('Redis connection error:', err.message);
});

redis.on('connect', () => {
  appLogger.info('Redis connected');
});

// Connect on first use
let connected = false;
const ensureConnected = async () => {
  if (!connected && redis.status === 'wait') {
    try {
      await redis.connect();
      connected = true;
    } catch (err) {
      appLogger.error('Failed to connect to Redis:', err);
      throw err;
    }
  }
};

// Export a proxy that ensures connection before operations
export const getRedis = async (): Promise<Redis> => {
  await ensureConnected();
  return redis;
};

export default redis;
