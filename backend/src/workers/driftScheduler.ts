import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "../queues/discoveryQueue.js";
import prisma from "../prismaClient.js";
import { runDriftCheck } from "../drift/driftDetectionService.js";

const schedulerQueueName = "driftScheduler";

async function runSchedulerCycle() {
  const now = new Date();

  // Find all enabled schedules that are due
  const dueSchedules = await prisma.driftSchedule.findMany({
    where: {
      enabled: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
  });

  for (const schedule of dueSchedules) {
    try {
      const result = await runDriftCheck(prisma, schedule.tenantId);

      // Update schedule timestamps
      const nextRun = computeNextRun(schedule.cronExpr);
      await prisma.driftSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, nextRunAt: nextRun },
      });

      // Send alerts if configured
      const hasCritical = result.drifts.some((d) => d.severity === "critical");
      const hasHigh = result.drifts.some((d) => d.severity === "high");

      if (
        (hasCritical && schedule.alertOnCritical) ||
        (hasHigh && schedule.alertOnHigh)
      ) {
        if (schedule.alertWebhook) {
          await sendWebhookAlert(schedule.alertWebhook, schedule.tenantId, result).catch(
            (err) => console.error("[Drift] Webhook alert failed", schedule.tenantId, err)
          );
        }
        // Email alerts would be handled by a mail service when available
        if (schedule.alertEmail) {
          console.log(
            `[Drift] Alert email would be sent to ${schedule.alertEmail} for tenant ${schedule.tenantId}: ${result.drifts.length} drift(s) detected`
          );
        }
      }

      console.log(
        `[Drift] Check completed for tenant ${schedule.tenantId}: ${result.drifts.length} drift(s), score=${result.resilienceScore.current}`
      );
    } catch (err) {
      console.error("[Drift] Check failed for tenant", schedule.tenantId, err);
    }
  }
}

async function sendWebhookAlert(
  webhookUrl: string,
  tenantId: string,
  result: Awaited<ReturnType<typeof runDriftCheck>>
) {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "drift.detected",
      tenantId,
      driftCount: result.drifts.length,
      severities: {
        critical: result.drifts.filter((d) => d.severity === "critical").length,
        high: result.drifts.filter((d) => d.severity === "high").length,
        medium: result.drifts.filter((d) => d.severity === "medium").length,
        low: result.drifts.filter((d) => d.severity === "low").length,
      },
      resilienceScore: result.resilienceScore,
      snapshotId: result.snapshot.id,
      timestamp: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
}

function computeNextRun(cronExpr: string): Date {
  // Simple next-run estimation based on common cron patterns
  // For production, use a cron parser library
  const now = new Date();
  const parts = cronExpr.split(" ");

  // Default: add 1 week (for "0 6 * * 1" which is default)
  if (parts[4] !== "*") {
    // Day-of-week based: add 7 days
    const next = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (parts[1] !== "*") next.setHours(parseInt(parts[1] ?? "0", 10), parseInt(parts[0] ?? "0", 10), 0, 0);
    return next;
  }

  if (parts[3] !== "*") {
    // Monthly: add 30 days
    return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  if (parts[2] !== "*") {
    // Day-of-month based
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }

  // Hourly or minute-based
  if (parts[1] !== "*") {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }

  // Every N minutes
  return new Date(now.getTime() + 30 * 60 * 1000);
}

export async function startDriftScheduler() {
  const connection = createRedisConnection();
  const schedulerQueue = new Queue(schedulerQueueName, { connection });
  const cronPattern = process.env.CRON_DRIFT_CHECK || "0 6 * * 1"; // Every Monday at 6AM

  await schedulerQueue.add(
    "drift.check",
    {},
    {
      repeat: { pattern: cronPattern },
      jobId: "drift-cron-schedule",
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
    console.error("[Drift] Scheduler failed", job?.id, err);
  });

  worker.on("completed", (job) => {
    console.log("[Drift] Scheduler cycle completed", job?.id);
  });

  console.log(`[Drift] Scheduler started with pattern: ${cronPattern}`);
  return worker;
}
