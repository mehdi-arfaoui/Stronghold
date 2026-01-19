import { Job, Worker } from "bullmq";
import prisma from "../prismaClient.js";
import { createRedisConnection } from "../queues/discoveryQueue.js";
import { getTracer } from "../observability/telemetry.js";
import { SpanStatusCode } from "@opentelemetry/api";
import { recordDiscoveryJobResult } from "../observability/metrics.js";
import { notifyN8nAlert } from "../services/n8nAlertService.js";
import { decryptDiscoveryCredentials } from "../services/discoveryService.js";
import { runDiscoveryEngine } from "../services/discoveryEngine.js";
import { resolveVaultCredentials } from "../services/discoveryVaultService.js";
import { emitDiscoveryProgress } from "../services/discoveryProgressService.js";

export type DiscoveryQueuePayload = {
  jobId: string;
  tenantId: string;
  ipRanges: string[];
  cloudProviders: string[];
  requestedBy: string | null;
  scheduleId?: string | null;
};

const discoverySteps = [
  { step: "SCAN_NETWORK", progress: 20 },
  { step: "FETCH_CLOUD", progress: 45 },
  { step: "INVENTORY_VIRTUAL", progress: 60 },
  { step: "CORRELATE_RESOURCES", progress: 80 },
  { step: "MAP_TO_DB", progress: 95 },
];

async function updateDiscoveryJob(tenantId: string, jobId: string, data: Record<string, unknown>) {
  const result = await prisma.discoveryJob.updateMany({
    where: { id: jobId, tenantId },
    data,
  });

  if (result.count === 0) {
    throw new Error("Discovery job not found for tenant");
  }

  emitDiscoveryProgress({
    tenantId,
    jobId,
    status: typeof data.status === "string" ? data.status : null,
    step: typeof data.step === "string" ? data.step : null,
    progress: typeof data.progress === "number" ? data.progress : null,
  });
}

async function recordDiscoveryHistory({
  tenantId,
  jobId,
  status,
  summary,
  errorMessage,
}: {
  tenantId: string;
  jobId: string;
  status: string;
  summary?: Record<string, unknown> | null;
  errorMessage?: string | null;
}) {
  const jobRecord = await prisma.discoveryJob.findFirst({
    where: { id: jobId, tenantId },
    select: { startedAt: true, completedAt: true, jobType: true },
  });
  await prisma.discoveryHistory.create({
    data: {
      tenantId,
      jobId,
      status,
      jobType: jobRecord?.jobType ?? null,
      startedAt: jobRecord?.startedAt ?? null,
      completedAt: jobRecord?.completedAt ?? null,
      summary: summary ?? undefined,
      errorMessage: errorMessage ?? null,
    },
  });
}

async function processDiscoveryJob(job: Job<DiscoveryQueuePayload>) {
  const { jobId, tenantId } = job.data;
  const tracer = getTracer();
  return tracer.startActiveSpan(
    "discovery.job",
    {
      attributes: {
        "tenant.id": tenantId,
        "discovery.job_id": jobId,
      },
    },
    async (span) => {
      try {
        await updateDiscoveryJob(tenantId, jobId, {
          status: "RUNNING",
          step: "SCAN_NETWORK",
          progress: 10,
          startedAt: new Date(),
          errorMessage: null,
        });

        for (const step of discoverySteps) {
          span.addEvent("discovery.step", { step: step.step });
          await updateDiscoveryJob(tenantId, jobId, {
            step: step.step,
            progress: step.progress,
            status: "RUNNING",
          });
        }

        const jobRecord = await prisma.discoveryJob.findFirst({
          where: { id: jobId, tenantId },
        });

        if (!jobRecord) {
          throw new Error("Discovery job not found for tenant");
        }

        const parameters = jobRecord.parameters ? JSON.parse(jobRecord.parameters) : {};
        const hasCredentials = Boolean(
          jobRecord.credentialsCiphertext && jobRecord.credentialsIv && jobRecord.credentialsTag
        );
        let credentials: Record<string, unknown> = {};
        if (hasCredentials) {
          const secret = process.env.DISCOVERY_SECRET;
          if (!secret) {
            throw new Error("DISCOVERY_SECRET requis pour déchiffrer les credentials");
          }
          credentials = decryptDiscoveryCredentials(
            {
              ciphertext: jobRecord.credentialsCiphertext as string,
              iv: jobRecord.credentialsIv as string,
              tag: jobRecord.credentialsTag as string,
            },
            secret
          );
        }
        credentials = await resolveVaultCredentials(credentials);

        const summary = await runDiscoveryEngine({
          tenantId,
          jobId,
          ipRanges: Array.isArray(parameters.ipRanges) ? parameters.ipRanges : [],
          cloudProviders: Array.isArray(parameters.cloudProviders) ? parameters.cloudProviders : [],
          credentials: credentials as any,
          requestedBy: parameters.requestedBy || null,
          autoCreate: Boolean(parameters.autoCreate),
        });

        const resultSummary = {
          discoveredResources: summary.discoveredResources,
          discoveredFlows: summary.discoveredFlows,
          matchedResources: summary.matchedResources,
          createdServices: summary.createdServices,
          createdInfra: summary.createdInfra,
          createdDependencies: summary.createdDependencies,
          createdInfraLinks: summary.createdInfraLinks,
          ignoredEdges: summary.ignoredEdges,
          addedResources: summary.addedResources,
          modifiedResources: summary.modifiedResources,
          removedResources: summary.removedResources,
          unmatchedResources: summary.unmatchedResources,
          shadowFlows: summary.shadowFlows,
          mergedDiscoveredResources: summary.mergedDiscoveredResources,
          updatedDiscoveredResources: summary.updatedDiscoveredResources,
          mergedServiceMatches: summary.mergedServiceMatches,
          mergedInfraMatches: summary.mergedInfraMatches,
          mergedServicesCreated: summary.mergedServicesCreated,
          mergedInfraCreated: summary.mergedInfraCreated,
          warnings: summary.warnings,
        };

        await updateDiscoveryJob(tenantId, jobId, {
          status: "COMPLETED",
          step: "COMPLETED",
          progress: 100,
          completedAt: new Date(),
          resultSummary: JSON.stringify(resultSummary),
        });
        await recordDiscoveryHistory({
          tenantId,
          jobId,
          status: "COMPLETED",
          summary: resultSummary,
        });
        emitDiscoveryProgress({
          tenantId,
          jobId,
          status: "COMPLETED",
          step: "COMPLETED",
          progress: 100,
          summary: resultSummary,
          completedAt: new Date(),
        });
        recordDiscoveryJobResult(true, tenantId);
        void notifyN8nAlert({
          event: "discovery.completed",
          tenantId,
          message: "Discovery job completed",
          details: {
            jobId,
            scheduleId: job.data.scheduleId ?? null,
            discoveredResources: summary.discoveredResources,
            discoveredFlows: summary.discoveredFlows,
            addedResources: summary.addedResources,
            modifiedResources: summary.modifiedResources,
            removedResources: summary.removedResources,
          },
        });
        if (summary.unmatchedResources > 0) {
          void notifyN8nAlert({
            event: "discovery.new_resource",
            tenantId,
            message: "New unlinked resources detected",
            details: {
              jobId,
              scheduleId: job.data.scheduleId ?? null,
              count: summary.unmatchedResources,
              samples: summary.newResourceSamples,
            },
          });
        }
        if (summary.shadowFlows > 0) {
          void notifyN8nAlert({
            event: "discovery.shadow_it",
            tenantId,
            message: "Shadow IT flows detected",
            details: {
              jobId,
              scheduleId: job.data.scheduleId ?? null,
              count: summary.shadowFlows,
              samples: summary.shadowFlowSamples,
            },
          });
        }
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        recordDiscoveryJobResult(false, tenantId);
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Discovery job error",
        });
        void notifyN8nAlert({
          event: "discovery.error",
          tenantId,
          message: error instanceof Error ? error.message : "Discovery job error",
        });
        throw error;
      } finally {
        span.end();
      }
    }
  );
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
        await recordDiscoveryHistory({
          tenantId: job.data.tenantId,
          jobId: job.data.jobId,
          status: "FAILED",
          errorMessage: message,
        });
        emitDiscoveryProgress({
          tenantId: job.data.tenantId,
          jobId: job.data.jobId,
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
