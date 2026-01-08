import { Job, Worker } from "bullmq";
import prisma from "../prismaClient";
import { createRedisConnection } from "../queues/discoveryQueue";

export type DiscoveryQueuePayload = {
  jobId: string;
  tenantId: string;
  ipRanges: string[];
  cloudProviders: string[];
  requestedBy: string | null;
};

const discoverySteps = [
  { step: "SCAN_NETWORK", progress: 20 },
  { step: "FETCH_CLOUD", progress: 45 },
  { step: "MERGE_GRAPH", progress: 70 },
  { step: "MAP_TO_DB", progress: 90 },
];

async function updateDiscoveryJob(tenantId: string, jobId: string, data: Record<string, unknown>) {
  const result = await prisma.discoveryJob.updateMany({
    where: { id: jobId, tenantId },
    data,
  });

  if (result.count === 0) {
    throw new Error("Discovery job not found for tenant");
  }
}

async function processDiscoveryJob(job: Job<DiscoveryQueuePayload>) {
  const { jobId, tenantId } = job.data;
  await updateDiscoveryJob(tenantId, jobId, {
    status: "RUNNING",
    step: "SCAN_NETWORK",
    progress: 10,
    startedAt: new Date(),
    errorMessage: null,
  });

  for (const step of discoverySteps) {
    await updateDiscoveryJob(tenantId, jobId, {
      step: step.step,
      progress: step.progress,
      status: "RUNNING",
    });
  }

  await updateDiscoveryJob(tenantId, jobId, {
    status: "COMPLETED",
    step: "COMPLETED",
    progress: 100,
    completedAt: new Date(),
    resultSummary: JSON.stringify({
      discoveredHosts: 0,
      createdServices: 0,
      createdInfra: 0,
      createdDependencies: 0,
      createdInfraLinks: 0,
    }),
  });
}

export function startDiscoveryWorker() {
  const connection = createRedisConnection();
  const worker = new Worker<DiscoveryQueuePayload>(
    "discoveryQueue",
    async (job) => {
      try {
        await processDiscoveryJob(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Discovery worker error";
        await updateDiscoveryJob(job.data.tenantId, job.data.jobId, {
          status: "FAILED",
          step: "FAILED",
          progress: 0,
          errorMessage: message,
          completedAt: new Date(),
        });
        throw error;
      }
    },
    { connection }
  );

  worker.on("failed", (job, err) => {
    console.error("Discovery worker failed", job?.id, err);
  });

  return worker;
}
