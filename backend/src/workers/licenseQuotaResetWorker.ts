import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../queues/discoveryQueue.js";
import { licenseService } from "../services/licenseService.js";
import { appLogger } from "../utils/logger.js";

const queueName = "licenseQuotaReset";

async function runMonthlyReset() {
  appLogger.info("[License] Starting monthly quota reset...");
  try {
    const count = await licenseService.resetMonthlyQuotas();
    appLogger.info(`[License] Reset monthly quotas for ${count} licenses`);
  } catch (error) {
    console.error("[License] Failed to reset monthly quotas:", error);
    throw error;
  }
}

export async function startLicenseQuotaResetWorker() {
  const connection = createRedisConnection();
  const queue = new Queue(queueName, { connection });

  // Run at 00:00 on the 1st of every month
  const cronPattern = process.env.CRON_LICENSE_RESET || "0 0 1 * *";

  await queue.add(
    "license.resetMonthlyQuotas",
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
    console.error("[License] Monthly quota reset failed", job?.id, err);
  });

  worker.on("completed", (job) => {
    appLogger.info("[License] Monthly quota reset completed", { jobId: job?.id });
  });

  appLogger.info(`[License] Quota reset worker scheduled with pattern: ${cronPattern}`);
  return worker;
}
