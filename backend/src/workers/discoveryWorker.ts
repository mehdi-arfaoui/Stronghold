import { appLogger } from "../utils/logger.js";
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
import { CloudEnrichmentService } from "../services/cloud-enrichment.service.js";
import { runDriftCheck } from "../drift/driftDetectionService.js";
import { toPrismaJson } from "../utils/prismaJson.js";
import { ingestDiscoveredResources } from "../discovery/discoveryOrchestrator.js";
import type { DiscoveredFlow, DiscoveredResource } from "../services/discoveryTypes.js";
import type { IngestReport } from "../graph/types.js";

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

const cloudEnrichmentService = new CloudEnrichmentService(prisma);

type LegacyGraphSyncLoadResult = {
  resources: DiscoveredResource[];
  flows: DiscoveredFlow[];
};

type LegacyGraphSyncOptions = {
  prismaClient?: typeof prisma;
  inferDependencies?: boolean;
  logger?: Pick<typeof appLogger, "info" | "warn">;
  loadScanData?: (tenantId: string, jobId: string) => Promise<LegacyGraphSyncLoadResult>;
  ingest?: typeof ingestDiscoveredResources;
};

function mapLegacyDiscoveryResource(resource: {
  source: string;
  externalId: string;
  name: string;
  kind: string;
  type: string;
  ip: string | null;
  hostname: string | null;
  tags: unknown;
  metadata: unknown;
}): DiscoveredResource {
  const kind = resource.kind === "service" ? "service" : "infra";
  const tags = Array.isArray(resource.tags)
    ? resource.tags.filter((value): value is string => typeof value === "string")
    : null;
  const metadata =
    resource.metadata && typeof resource.metadata === "object" && !Array.isArray(resource.metadata)
      ? (resource.metadata as Record<string, unknown>)
      : null;

  return {
    source: resource.source,
    externalId: resource.externalId,
    name: resource.name,
    kind,
    type: resource.type,
    ip: resource.ip,
    hostname: resource.hostname,
    tags,
    metadata,
  };
}

function mapLegacyDiscoveryFlow(flow: {
  sourceIp: string | null;
  targetIp: string | null;
  sourcePort: number | null;
  targetPort: number | null;
  protocol: string | null;
  bytes: number | null;
  packets: number | null;
  observedAt: Date;
}): DiscoveredFlow {
  return {
    sourceIp: flow.sourceIp,
    targetIp: flow.targetIp,
    sourcePort: flow.sourcePort,
    targetPort: flow.targetPort,
    protocol: flow.protocol,
    bytes: flow.bytes,
    packets: flow.packets,
    observedAt: flow.observedAt,
  };
}

async function loadLegacyDiscoveryJobData(
  prismaClient: typeof prisma,
  tenantId: string,
  jobId: string,
): Promise<LegacyGraphSyncLoadResult> {
  const [resources, flows] = await Promise.all([
    prismaClient.discoveryResource.findMany({
      where: { tenantId, jobId },
      select: {
        source: true,
        externalId: true,
        name: true,
        kind: true,
        type: true,
        ip: true,
        hostname: true,
        tags: true,
        metadata: true,
      },
    }),
    prismaClient.discoveryFlow.findMany({
      where: { tenantId, jobId },
      select: {
        sourceIp: true,
        targetIp: true,
        sourcePort: true,
        targetPort: true,
        protocol: true,
        bytes: true,
        packets: true,
        observedAt: true,
      },
    }),
  ]);

  return {
    resources: resources.map(mapLegacyDiscoveryResource),
    flows: flows.map(mapLegacyDiscoveryFlow),
  };
}

export async function syncDiscoveryJobToResilienceGraph(
  input: {
    tenantId: string;
    jobId: string;
  } & LegacyGraphSyncOptions,
): Promise<IngestReport | null> {
  const prismaClient = input.prismaClient ?? prisma;
  const logger = input.logger ?? appLogger;
  const loadScanData = input.loadScanData ?? ((tenantId: string, jobId: string) => loadLegacyDiscoveryJobData(prismaClient, tenantId, jobId));
  const ingest = input.ingest ?? ingestDiscoveredResources;
  const inferDependencies = input.inferDependencies !== false;

  logger.info("[DiscoveryWorker] Syncing scan results to resilience graph...", {
    tenantId: input.tenantId,
    jobId: input.jobId,
    inferDependencies,
  });

  const discoveryData = await loadScanData(input.tenantId, input.jobId);
  if (discoveryData.resources.length === 0 && discoveryData.flows.length === 0) {
    logger.warn("[DiscoveryWorker] Graph sync skipped because no legacy scan data was found", {
      tenantId: input.tenantId,
      jobId: input.jobId,
    });
    return null;
  }

  const report = await ingest(
    prismaClient,
    input.tenantId,
    discoveryData.resources,
    discoveryData.flows,
    "legacy-discovery",
    { inferDependencies },
  );

  logger.info("[DiscoveryWorker] Graph sync completed", {
    tenantId: input.tenantId,
    jobId: input.jobId,
    totalNodes: report.totalNodes,
    totalEdges: report.totalEdges,
  });

  return report;
}

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
      ...(summary != null ? { summary: toPrismaJson(summary) } : {}),
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

        let graphSyncReport: IngestReport | null = null;
        try {
          graphSyncReport = await syncDiscoveryJobToResilienceGraph({
            tenantId,
            jobId,
            inferDependencies: parameters.inferDependencies !== false,
          });
        } catch (graphSyncError) {
          appLogger.warn(
            "[DiscoveryWorker] Graph sync failed — scan results are saved but resilience features unavailable",
            {
              tenantId,
              jobId,
              message: graphSyncError instanceof Error ? graphSyncError.message : "unknown",
            },
          );
        }

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
          graphNodesSynced: graphSyncReport?.totalNodes ?? 0,
          graphEdgesSynced: graphSyncReport?.totalEdges ?? 0,
          graphNodesCreated: graphSyncReport?.nodesCreated ?? 0,
          graphNodesUpdated: graphSyncReport?.nodesUpdated ?? 0,
          graphEdgesCreated: graphSyncReport?.edgesCreated ?? 0,
          graphEdgesUpdated: graphSyncReport?.edgesUpdated ?? 0,
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
        // Trigger cloud enrichment suggestions asynchronously after each completed scan.
        void cloudEnrichmentService
          .enrichFromCloudData(tenantId)
          .catch((enrichmentError) => {
            const message =
              enrichmentError instanceof Error
                ? enrichmentError.message
                : "cloud enrichment failed";
            appLogger.warn("Cloud enrichment post-scan failed", { tenantId, jobId, message });
          });

        const shouldRunScheduledDrift =
          jobRecord.jobType === "SCHEDULED_SCAN" || Boolean(job.data.scheduleId);
        if (shouldRunScheduledDrift) {
          void runDriftCheck(prisma, tenantId, {
            comparisonMode: "latest",
            scanId: jobId,
          }).then((driftResult) => {
            appLogger.info("scheduled_scan.drift_complete", {
              tenantId,
              jobId,
              driftCount: driftResult.drifts.length,
              snapshotId: driftResult.snapshot.id,
            });
          }).catch((driftError) => {
            appLogger.error("scheduled_scan.drift_failed", {
              tenantId,
              jobId,
              message: driftError instanceof Error ? driftError.message : "unknown",
            });
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
    appLogger.error("Discovery worker failed", job?.id, err);
  });

  return worker;
}
