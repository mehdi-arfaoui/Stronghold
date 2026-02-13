import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../queues/discoveryQueue.js";
import { rotateExpiringApiKeys } from "../services/apiKeyRotationService.js";
import { appLogger } from "../utils/logger.js";

const rotationQueueName = "apiKeyRotationScheduler";

export async function startApiKeyRotationWorker() {
  const connection = createRedisConnection();
  const rotationQueue = new Queue(rotationQueueName, { connection });
  const cronPattern = process.env.CRON_API_KEY_ROTATION || "0 */6 * * *";

  await rotationQueue.add(
    "apiKey.rotate",
    {},
    {
      repeat: { pattern: cronPattern },
      jobId: "api-key-rotation-cron",
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  const worker = new Worker(
    rotationQueueName,
    async () => {
      const result = await rotateExpiringApiKeys();
      if (result.reason) {
        console.warn("API key rotation skipped", { reason: result.reason });
      } else {
        appLogger.info("API key rotation summary", {
          rotated: result.rotated,
          skipped: result.skipped,
        });
      }
    },
    { connection }
  );

  worker.on("failed", (job, err) => {
    console.error("API key rotation failed", job?.id, err);
  });

  return worker;
}
