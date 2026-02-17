import { Queue, type ConnectionOptions } from "bullmq";
import { buildRedisConnectionOptions } from "../utils/redisConnection.js";

export function createRedisConnection(): ConnectionOptions {
  return {
    ...buildRedisConnectionOptions(),
    maxRetriesPerRequest: null,
  };
}

export const discoveryQueue = new Queue("discoveryQueue", {
  connection: createRedisConnection(),
});
