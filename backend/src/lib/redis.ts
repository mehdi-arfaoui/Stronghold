import { Redis, type RedisOptions } from 'ioredis';
import { appLogger } from '../utils/logger.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Parse Redis URL for connection options
const parseRedisUrl = (url: string): RedisOptions => {
  try {
    const parsed = new URL(url);
    const options: RedisOptions = {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
      db: parsed.pathname ? parseInt(parsed.pathname.slice(1) || '0', 10) : 0,
    };
    // Only add username/password if they exist
    if (parsed.username) {
      options.username = parsed.username;
    }
    if (parsed.password) {
      options.password = parsed.password;
    }
    return options;
  } catch {
    return {
      host: 'localhost',
      port: 6379,
      db: 0,
    };
  }
};

const connectionOptions = parseRedisUrl(REDIS_URL);

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
