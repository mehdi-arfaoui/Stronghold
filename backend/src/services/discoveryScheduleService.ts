import prisma from "../prismaClient.js";
import { discoveryQueue } from "../queues/discoveryQueue.js";

type ScheduleConfig = {
  dayOfWeek?: number;
  hour?: number;
  minute?: number;
  timezone?: string;
};

type CreateScheduleInput = {
  tenantId: string;
  name: string;
  ipRanges: string[];
  cloudProviders: string[];
  frequency: "DAILY" | "WEEKLY";
  scheduleConfig: ScheduleConfig;
  requestedByApiKeyId?: string | null;
};

function normalizeNumber(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return value;
}

export function computeNextRunAt(frequency: "DAILY" | "WEEKLY", config: ScheduleConfig) {
  const now = new Date();
  const hour = normalizeNumber(config.hour, 2);
  const minute = normalizeNumber(config.minute, 0);
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));

  if (frequency === "DAILY") {
    if (target <= now) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    return target;
  }

  const dayOfWeek = normalizeNumber(config.dayOfWeek, 1);
  const currentDay = now.getUTCDay();
  let delta = dayOfWeek - currentDay;
  if (delta < 0 || (delta === 0 && target <= now)) {
    delta += 7;
  }
  target.setUTCDate(target.getUTCDate() + delta);
  return target;
}

export async function createDiscoverySchedule(input: CreateScheduleInput) {
  const nextRunAt = computeNextRunAt(input.frequency, input.scheduleConfig);
  return prisma.discoverySchedule.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      ipRanges: input.ipRanges,
      cloudProviders: input.cloudProviders,
      frequency: input.frequency,
      scheduleConfig: input.scheduleConfig,
      nextRunAt,
      active: true,
    },
  });
}

async function enqueueScheduledJob(schedule: any) {
  const job = await prisma.discoveryJob.create({
    data: {
      tenantId: schedule.tenantId,
      status: "QUEUED",
      jobType: "SCHEDULED_RUN",
      progress: 0,
      step: "QUEUED",
      parameters: JSON.stringify({
        ipRanges: schedule.ipRanges,
        cloudProviders: schedule.cloudProviders,
        scheduleId: schedule.id,
      }),
      requestedByApiKeyId: null,
    },
  });

  await discoveryQueue.add("discovery-run", {
    jobId: job.id,
    tenantId: schedule.tenantId,
    ipRanges: schedule.ipRanges,
    cloudProviders: schedule.cloudProviders,
    requestedBy: "schedule",
    scheduleId: schedule.id,
  });

  if (Array.isArray(schedule.ipRanges) && schedule.ipRanges.length > 0) {
    await prisma.discoveryScanAudit.createMany({
      data: schedule.ipRanges.map((range: string) => ({
        tenantId: schedule.tenantId,
        jobId: job.id,
        apiKeyId: null,
        ipRange: range,
      })),
    });
  }

  const nextRunAt = computeNextRunAt(schedule.frequency, schedule.scheduleConfig);
  await prisma.discoverySchedule.update({
    where: { id: schedule.id },
    data: {
      lastRunAt: new Date(),
      nextRunAt,
    },
  });
}

export function startDiscoveryScheduler() {
  const intervalMs = Number(process.env.DISCOVERY_SCHEDULER_INTERVAL_MS || "60000");
  const timer = setInterval(async () => {
    const now = new Date();
    const dueSchedules = await prisma.discoverySchedule.findMany({
      where: {
        active: true,
        nextRunAt: { lte: now },
      },
    });

    for (const schedule of dueSchedules) {
      await enqueueScheduledJob(schedule);
    }
  }, intervalMs);

  return timer;
}
