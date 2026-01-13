import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export function createDocumentIngestionConnection() {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export const documentIngestionQueue = new Queue("documentIngestionQueue", {
  connection: createDocumentIngestionConnection(),
});
