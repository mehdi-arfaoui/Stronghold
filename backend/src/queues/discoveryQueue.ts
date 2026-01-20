import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

function buildRedisConnectionOptions() {
  try {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || "6379"),
      ...(parsed.username ? { username: parsed.username } : {}),
      ...(parsed.password ? { password: parsed.password } : {}),
      ...(parsed.pathname && parsed.pathname.length > 1
        ? { db: Number(parsed.pathname.slice(1)) }
        : {}),
      maxRetriesPerRequest: null,
    };
  } catch {
    return { host: "localhost", port: 6379, maxRetriesPerRequest: null };
  }
}

export function createRedisConnection() {
  return buildRedisConnectionOptions();
}

export const discoveryQueue = new Queue("discoveryQueue", {
  connection: createRedisConnection(),
});
