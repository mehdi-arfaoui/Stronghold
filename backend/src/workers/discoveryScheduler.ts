import { Queue, Worker } from "bullmq";
import { createRedisConnection, discoveryQueue } from "../queues/discoveryQueue.js";
import { enqueueScheduledJob, listDueDiscoverySchedules } from "../services/discoveryScheduleService.js";

const schedulerQueueName = "discoveryScheduler";

async function runSchedulerCycle() {
  const now = new Date();
  const dueSchedules = await listDueDiscoverySchedules(now);
  for (const schedule of dueSchedules) {
    await enqueueScheduledJob(schedule);
  }
}

export async function startDiscoveryScheduler() {
  const connection = createRedisConnection();
  const schedulerQueue = new Queue(schedulerQueueName, { connection });
  const cronPattern = process.env.CRON_DISCOVERY || "*/30 * * * *";

  await schedulerQueue.add(
    "discovery.run",
    {},
    {
      repeat: { pattern: cronPattern },
      jobId: "discovery-cron-schedule",
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  const worker = new Worker(
    schedulerQueueName,
    async () => {
      await runSchedulerCycle();
    },
    { connection }
  );

  worker.on("failed", (job, err) => {
    console.error("Discovery scheduler failed", job?.id, err);
  });

  await discoveryQueue.waitUntilReady();
  return worker;
}
