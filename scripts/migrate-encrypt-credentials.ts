import prisma from "../backend/src/prismaClient.js";
import {
  encryptScanConfigCredentials,
  scanConfigHasPlaintextCredentials,
} from "../backend/src/services/scanConfigSecurityService.js";
import { resolveCredentialEncryptionKey } from "../backend/src/utils/credential-encryption.js";

async function migrateScanJobs(encryptionKey: string): Promise<number> {
  const jobs = await prisma.scanJob.findMany({
    select: {
      id: true,
      config: true,
    },
  });

  let migrated = 0;
  for (const job of jobs) {
    if (!scanConfigHasPlaintextCredentials(job.config)) continue;
    const encryptedConfig = encryptScanConfigCredentials(job.config, encryptionKey);
    await prisma.scanJob.update({
      where: { id: job.id },
      data: { config: encryptedConfig as any },
    });
    migrated += 1;
  }

  return migrated;
}

async function migrateScanSchedules(encryptionKey: string): Promise<number> {
  const schedules = await prisma.scanSchedule.findMany({
    select: {
      id: true,
      config: true,
    },
  });

  let migrated = 0;
  for (const schedule of schedules) {
    if (!scanConfigHasPlaintextCredentials(schedule.config)) continue;
    const encryptedConfig = encryptScanConfigCredentials(schedule.config, encryptionKey);
    await prisma.scanSchedule.update({
      where: { id: schedule.id },
      data: { config: encryptedConfig as any },
    });
    migrated += 1;
  }

  return migrated;
}

async function main() {
  const encryptionKey = resolveCredentialEncryptionKey();
  const [scanJobsMigrated, scanSchedulesMigrated] = await Promise.all([
    migrateScanJobs(encryptionKey),
    migrateScanSchedules(encryptionKey),
  ]);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        scanJobsMigrated,
        scanSchedulesMigrated,
        totalMigrated: scanJobsMigrated + scanSchedulesMigrated,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Credential migration failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
