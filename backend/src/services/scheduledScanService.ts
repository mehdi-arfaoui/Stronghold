import { Prisma } from "@prisma/client";
import prisma from "../prismaClient.js";
import { discoveryQueue } from "../queues/discoveryQueue.js";
import { encryptDiscoveryCredentials } from "./discoveryService.js";
import { appLogger } from "../utils/logger.js";
import {
  decryptCredential,
  isEncryptedCredential,
  resolveCredentialEncryptionKey,
} from "../utils/credential-encryption.js";

type ScanScheduleRecord = {
  id: string;
  tenantId: string;
  cronExpression: string;
  config: Prisma.JsonValue;
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
};

const DEFAULT_INTERVAL_MINUTES = 24 * 60;
const runningSchedules = new Set<string>();
let schedulerTimer: NodeJS.Timeout | null = null;

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function decryptValue(value: unknown, key: string): unknown {
  if (typeof value === "string") {
    if (!isEncryptedCredential(value)) return value;
    try {
      return decryptCredential(value, key);
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map((entry) => decryptValue(entry, key));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([entryKey, entryValue]) => [entryKey, decryptValue(entryValue, key)]),
    );
  }
  return value;
}

function decryptScheduleConfig(config: Record<string, unknown>): Record<string, unknown> {
  let key: string | null = null;
  try {
    key = resolveCredentialEncryptionKey();
  } catch {
    key = null;
  }
  if (!key) return config;
  return decryptValue(config, key) as Record<string, unknown>;
}

export function intervalToCronExpression(intervalMinutes: number): string {
  const normalized = Number.isFinite(intervalMinutes) && intervalMinutes > 0
    ? Math.round(intervalMinutes)
    : DEFAULT_INTERVAL_MINUTES;

  if (normalized <= 60) return "0 * * * *";
  if (normalized <= 24 * 60) return "0 0 * * *";
  return "0 0 * * 0";
}

export function cronExpressionToIntervalMinutes(cronExpression: string): number {
  const normalized = readString(cronExpression).toLowerCase();
  if (!normalized) return DEFAULT_INTERVAL_MINUTES;
  if (normalized === "0 * * * *") return 60;
  if (normalized === "0 0 * * *") return 24 * 60;
  if (normalized === "0 0 * * 0" || normalized === "0 0 * * 7") return 7 * 24 * 60;

  const minuteStep = normalized.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (minuteStep) {
    const minutes = Number(minuteStep[1]);
    if (Number.isFinite(minutes) && minutes > 0) return minutes;
  }

  const hourStep = normalized.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (hourStep) {
    const hours = Number(hourStep[1]);
    if (Number.isFinite(hours) && hours > 0) return hours * 60;
  }

  return DEFAULT_INTERVAL_MINUTES;
}

export function resolveScheduleIntervalMinutes(schedule: Pick<ScanScheduleRecord, "cronExpression" | "config">): number {
  const config = readRecord(schedule.config);
  const options = readRecord(config.options);
  const configured = Number(options.scanIntervalMinutes ?? config.scanIntervalMinutes);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.round(configured);
  }
  return cronExpressionToIntervalMinutes(schedule.cronExpression);
}

function buildNextRunAt(intervalMinutes: number): Date {
  return new Date(Date.now() + Math.max(1, intervalMinutes) * 60 * 1000);
}

function parseScheduleSources(config: Record<string, unknown>) {
  const providersRaw = Array.isArray(config.providers) ? config.providers : [];
  const onPremise = readRecord(config.onPremise);
  const options = readRecord(config.options);
  const inferDependencies = options.inferDependencies !== false;

  const providers: string[] = [];
  const combinedCredentials: Record<string, unknown> = {};

  for (const providerEntry of providersRaw) {
    const providerRecord = readRecord(providerEntry);
    const providerType = readString(providerRecord.type || providerRecord.provider).toLowerCase();
    if (!providerType || !["aws", "azure", "gcp"].includes(providerType)) continue;
    const credentials = readRecord(providerRecord.credentials);
    if (Object.keys(credentials).length === 0) continue;
    providers.push(providerType);
    combinedCredentials[providerType] = credentials;
  }

  const kubernetesRaw = Array.isArray(config.kubernetes) ? config.kubernetes : [];
  if (kubernetesRaw.length > 0) {
    const firstCluster = readRecord(kubernetesRaw[0]);
    const kubeconfig = readString(firstCluster.kubeconfig);
    if (kubeconfig) {
      combinedCredentials.kubernetes = {
        kubeconfig,
        ...(readString(firstCluster.context) ? { context: readString(firstCluster.context) } : {}),
        ...(readString(firstCluster.name) ? { name: readString(firstCluster.name) } : {}),
      };
    }
  }

  const ipRanges = Array.isArray(onPremise.ipRanges)
    ? onPremise.ipRanges
        .map((entry) => readString(entry))
        .filter((entry) => entry.length > 0)
    : [];

  return {
    cloudProviders: Array.from(new Set(providers)),
    ipRanges,
    combinedCredentials,
    inferDependencies,
  };
}

export function mapScanScheduleForApi(schedule: ScanScheduleRecord) {
  const intervalMinutes = resolveScheduleIntervalMinutes(schedule);
  return {
    id: schedule.id,
    tenantId: schedule.tenantId,
    enabled: schedule.isActive,
    intervalMinutes,
    cronExpression: schedule.cronExpression,
    lastScanAt: schedule.lastRunAt,
    nextScanAt: schedule.nextRunAt,
  };
}

export async function enqueueScheduledScanRun(
  schedule: ScanScheduleRecord,
  options?: { trigger?: "interval" | "manual"; now?: Date },
): Promise<string | null> {
  const now = options?.now ?? new Date();
  const trigger = options?.trigger ?? "interval";
  const decryptedConfig = decryptScheduleConfig(readRecord(schedule.config));
  const parsed = parseScheduleSources(decryptedConfig);

  if (parsed.cloudProviders.length === 0 && parsed.ipRanges.length === 0) {
    appLogger.warn("scheduled_scan.skipped", {
      tenantId: schedule.tenantId,
      scheduleId: schedule.id,
      reason: "no_valid_sources",
    });
    return null;
  }

  const secret = process.env.DISCOVERY_SECRET;
  const encryptedCredentials =
    Object.keys(parsed.combinedCredentials).length > 0 && secret
      ? encryptDiscoveryCredentials(parsed.combinedCredentials, secret)
      : null;

  const job = await prisma.discoveryJob.create({
    data: {
      tenantId: schedule.tenantId,
      status: "QUEUED",
      jobType: "SCHEDULED_SCAN",
      progress: 0,
      step: "QUEUED",
      parameters: JSON.stringify({
        ipRanges: parsed.ipRanges,
        cloudProviders: parsed.cloudProviders,
        scheduleId: schedule.id,
        requestedBy: "scheduled-scan",
        autoCreate: false,
        inferDependencies: parsed.inferDependencies,
        scheduleTrigger: trigger,
      }),
      ...(encryptedCredentials
        ? {
            credentialsCiphertext: encryptedCredentials.ciphertext,
            credentialsIv: encryptedCredentials.iv,
            credentialsTag: encryptedCredentials.tag,
          }
        : {}),
      requestedByApiKeyId: null,
    },
  });

  if (parsed.ipRanges.length > 0) {
    await prisma.discoveryScanAudit.createMany({
      data: parsed.ipRanges.map((range) => ({
        tenantId: schedule.tenantId,
        jobId: job.id,
        apiKeyId: null,
        ipRange: range,
      })),
    });
  }

  await discoveryQueue.add("discovery.run", {
    jobId: job.id,
    tenantId: schedule.tenantId,
    ipRanges: parsed.ipRanges,
    cloudProviders: parsed.cloudProviders,
    requestedBy: "scheduled-scan",
    scheduleId: schedule.id,
  });

  const intervalMinutes = resolveScheduleIntervalMinutes(schedule);
  await prisma.scanSchedule.updateMany({
    where: {
      id: schedule.id,
      tenantId: schedule.tenantId,
    },
    data: {
      lastRunAt: now,
      nextRunAt: buildNextRunAt(intervalMinutes),
    },
  });

  appLogger.info("scheduled_scan.enqueued", {
    tenantId: schedule.tenantId,
    scheduleId: schedule.id,
    jobId: job.id,
    intervalMinutes,
    trigger,
  });

  return job.id;
}

export async function processDueScheduledScans(now = new Date()) {
  const schedules = await prisma.scanSchedule.findMany({
    where: {
      isActive: true,
      nextRunAt: { lte: now },
    },
    orderBy: { nextRunAt: "asc" },
  });

  for (const schedule of schedules) {
    if (runningSchedules.has(schedule.id)) continue;
    runningSchedules.add(schedule.id);
    try {
      await enqueueScheduledScanRun(schedule, { trigger: "interval", now });
    } catch (error) {
      appLogger.error("scheduled_scan.failed", {
        tenantId: schedule.tenantId,
        scheduleId: schedule.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      runningSchedules.delete(schedule.id);
    }
  }
}

export async function startDiscoveryScheduler() {
  if (schedulerTimer) return schedulerTimer;

  const intervalMs = Number(process.env.DISCOVERY_SCHEDULER_INTERVAL_MS || "60000");
  await processDueScheduledScans().catch((error) => {
    appLogger.error("scheduled_scan.start_cycle_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  });

  schedulerTimer = setInterval(() => {
    void processDueScheduledScans().catch((error) => {
      appLogger.error("scheduled_scan.cycle_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  }, Math.max(15_000, intervalMs));

  appLogger.info("scheduled_scan.service_started", {
    intervalMs: Math.max(15_000, intervalMs),
  });

  return schedulerTimer;
}
