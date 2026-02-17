import { Queue } from "bullmq";
import { buildRedisConnectionOptions } from "../utils/redisConnection.js";

export function createDocumentIngestionConnection() {
  return {
    ...buildRedisConnectionOptions(),
    maxRetriesPerRequest: null,
  };
}

export const documentIngestionQueue = new Queue("documentIngestionQueue", {
  connection: createDocumentIngestionConnection(),
});
