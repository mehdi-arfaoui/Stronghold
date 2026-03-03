import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../queues/discoveryQueue.js";
import { licenseService } from "../services/licenseService.js";
import { appLogger } from "../utils/logger.js";

const queueName = "licenseQuotaReset";

async function runMonthlyReset() {
  appLogger.info("[License] Starting scheduled license maintenance check...");
  try {
    const count = await licenseService.resetMonthlyQuotas();
    appLogger.info(`[License] Scheduled license maintenance completed (${count})`);
  } catch (error) {
    appLogger.error("[License] Scheduled license maintenance failed:", error);
    throw error;
  }
}

export async function startLicenseQuotaResetWorker() {
  const connection = createRedisConnection();
  const queue = new Queue(queueName, { connection });

  // Run at 00:00 on the 1st of every month
  const cronPattern = process.env.CRON_LICENSE_RESET || "0 0 1 * *";

  await queue.add(
    "license.maintenance",
    {},
    {
      repeat: { pattern: cronPattern },
      jobId: "license-monthly-quota-reset",
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  const worker = new Worker(
    queueName,
    async () => {
      await runMonthlyReset();
    },
    { connection }
  );

  worker.on("failed", (job, err) => {
    appLogger.error("[License] Scheduled license maintenance failed", job?.id, err);
  });

  worker.on("completed", (job) => {
    appLogger.info("[License] Scheduled license maintenance completed", { jobId: job?.id });
  });

  appLogger.info(`[License] Maintenance worker scheduled with pattern: ${cronPattern}`);
  return worker;
}
