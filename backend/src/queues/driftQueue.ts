import { Queue } from "bullmq";
import { createRedisConnection } from "./discoveryQueue.js";

export const driftQueue = new Queue("driftQueue", {
  connection: createRedisConnection(),
});
