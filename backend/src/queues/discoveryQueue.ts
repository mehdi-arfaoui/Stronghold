import { Queue } from "bullmq";
import { buildRedisConnectionOptions } from "../utils/redisConnection.js";

export function createRedisConnection() {
  return {
    ...buildRedisConnectionOptions(),
    maxRetriesPerRequest: null,
  };
}

export const discoveryQueue = new Queue("discoveryQueue", {
  connection: createRedisConnection(),
});
