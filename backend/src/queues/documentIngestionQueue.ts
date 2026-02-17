import { Queue, type ConnectionOptions } from "bullmq";
import { buildRedisConnectionOptions } from "../utils/redisConnection.js";

export function createDocumentIngestionConnection(): ConnectionOptions {
  return {
    ...buildRedisConnectionOptions(),
    maxRetriesPerRequest: null,
  };
}

export const documentIngestionQueue = new Queue("documentIngestionQueue", {
  connection: createDocumentIngestionConnection(),
});
