import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export function createRedisConnection() {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export const discoveryQueue = new Queue("discoveryQueue", {
  connection: createRedisConnection(),
});
