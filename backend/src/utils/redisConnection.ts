import type { RedisOptions } from "ioredis";

const DEFAULT_REDIS_URL = "redis://localhost:6379";

function resolveConfiguredRedisUrl(): string {
  return process.env.REDIS_URL || DEFAULT_REDIS_URL;
}

export function buildRedisConnectionOptions(): RedisOptions {
  const fallbackPassword = process.env.REDIS_PASSWORD;
  const redisUrl = resolveConfiguredRedisUrl();

  try {
    const parsed = new URL(redisUrl);
    const options: RedisOptions = {
      host: parsed.hostname || "localhost",
      port: Number(parsed.port || "6379"),
      db: parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    };

    if (parsed.username) {
      options.username = parsed.username;
    }

    if (parsed.password) {
      options.password = parsed.password;
    } else if (fallbackPassword) {
      options.password = fallbackPassword;
    }

    return options;
  } catch {
    return {
      host: "localhost",
      port: 6379,
      db: 0,
      ...(fallbackPassword ? { password: fallbackPassword } : {}),
    };
  }
}
