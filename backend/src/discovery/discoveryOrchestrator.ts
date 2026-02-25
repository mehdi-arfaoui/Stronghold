// ============================================================
// DiscoveryOrchestrator — Coordinates scanning + graph ingestion
// Bridges the existing discovery infrastructure with the
// new resilience graph engine.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import type { IngestReport } from '../graph/types.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { inferDependencies } from '../graph/dependencyInferenceEngine.js';
import { transformToScanResult } from './graphBridge.js';
import { validateScanConsistency } from '../services/discoveryHealthService.js';
import type { DiscoveredResource, DiscoveredFlow } from '../services/discoveryTypes.js';
import {
  encryptScanConfigCredentials,
  sanitizeScanConfig,
} from "../services/scanConfigSecurityService.js";

export interface DiscoveryScanConfig {
  providers: Array<{
    type: 'aws' | 'azure' | 'gcp';
    credentials: Record<string, unknown>;
    regions?: string[];
    subscriptionIds?: string[];
    projectIds?: string[];
  }>;
  kubernetes?: Array<{
    name: string;
    kubeconfig: string;
  }>;
  onPremise?: {
    ipRanges: string[];
  };
  options?: {
    inferDependencies?: boolean;
    scanIntervalMinutes?: number;
  };
}

export interface ScanJobProgress {
  status: 'queued' | 'scanning' | 'inferring' | 'reconciling' | 'completed' | 'failed';
  progress: {
    totalAdapters: number;
    completedAdapters: number;
    currentAdapter: string;
    nodesDiscovered: number;
    edgesDiscovered: number;
  };
  result?: IngestReport;
  error?: string;
}

/**
 * Creates a scan job record in the database.
 */
export async function createScanJob(
  prisma: PrismaClient,
  tenantId: string,
  config: DiscoveryScanConfig
): Promise<string> {
  const encryptedConfig = encryptScanConfigCredentials(config);
  const job = await prisma.scanJob.create({
    data: {
      status: 'queued',
      config: JSON.parse(JSON.stringify(encryptedConfig)),
      tenantId,
    },
  });
  return job.id;
}

/**
 * Gets scan job status from the database.
 */
export async function getScanJobStatus(
  prisma: PrismaClient,
  jobId: string,
  tenantId: string
): Promise<ScanJobProgress | null> {
  const job = await prisma.scanJob.findFirst({
    where: { id: jobId, tenantId },
  });

  if (!job) return null;

  const progress: ScanJobProgress = {
    status: job.status as ScanJobProgress['status'],
    progress: (job.progress as any) || {
      totalAdapters: 0,
      completedAdapters: 0,
      currentAdapter: '',
      nodesDiscovered: 0,
      edgesDiscovered: 0,
    },
  };
  if (job.result) progress.result = job.result as unknown as IngestReport;
  if (job.error) progress.error = job.error;
  return progress;
}

/**
 * Updates scan job progress in the database.
 */
export async function updateScanJobProgress(
  prisma: PrismaClient,
  jobId: string,
  update: Partial<ScanJobProgress>
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (update.status) data.status = update.status;
  if (update.progress) data.progress = JSON.parse(JSON.stringify(update.progress));
  if (update.result) data.result = JSON.parse(JSON.stringify(update.result));
  if (update.error) data.error = update.error;
  if (update.status === 'scanning') data.startedAt = new Date();
  if (update.status === 'completed' || update.status === 'failed') data.completedAt = new Date();

  await prisma.scanJob.update({
    where: { id: jobId },
    data,
  });
}

async function persistLatestGraphAnalysis(prisma: PrismaClient, tenantId: string): Promise<void> {
  const graph = await GraphService.getGraph(prisma, tenantId);
  if (graph.order === 0) return;

  const report = await analyzeFullGraph(graph);
  await prisma.graphAnalysis.create({
    data: {
      resilienceScore: report.resilienceScore,
      totalNodes: report.totalNodes,
      totalEdges: report.totalEdges,
      spofCount: report.spofs.length,
      report: JSON.parse(JSON.stringify({
        spofs: report.spofs,
        redundancyIssues: report.redundancyIssues,
        regionalRisks: report.regionalRisks,
        circularDeps: report.circularDeps,
        cascadeChains: report.cascadeChains.slice(0, 20),
        criticalityScores: Object.fromEntries(report.criticalityScores),
      })),
      tenantId,
    },
  });

  const spofIds = new Set(report.spofs.map((spof) => spof.nodeId));
  await Promise.all(
    Array.from(report.criticalityScores.entries()).map(async ([nodeId, score]) => {
      const blast = GraphService.getBlastRadius(graph, nodeId);
      await prisma.infraNode.updateMany({
        where: { id: nodeId, tenantId },
        data: {
          criticalityScore: score,
          isSPOF: spofIds.has(nodeId),
          blastRadius: blast.length,
        },
      });
    })
  );
}

/**
 * Processes discovered resources from any source and ingests them
 * into the resilience graph.
 *
 * This is the main entry point called by the discovery worker
 * after cloud/network scanning completes.
 */
export async function ingestDiscoveredResources(
  prisma: PrismaClient,
  tenantId: string,
  resources: DiscoveredResource[],
  flows: DiscoveredFlow[],
  provider: string,
  options?: { inferDependencies?: boolean }
): Promise<IngestReport> {
  // 1. Transform discovered resources to ScanResult format
  const scanResult = transformToScanResult(resources, flows, provider);

  // 2. Optionally run dependency inference
  if (options?.inferDependencies !== false) {
    const inferredEdges = inferDependencies(scanResult.nodes, scanResult.edges);
    scanResult.edges = [...scanResult.edges, ...inferredEdges];
  }

  // 3. Ingest into the resilience graph via GraphService
  const report = await GraphService.ingestScanResults(prisma, tenantId, scanResult);

  // 4. Refresh resilience analysis so dashboard metrics stay in sync with latest scan.
  await persistLatestGraphAnalysis(prisma, tenantId);

  // 5. Run post-scan validation checks automatically
  const validation = await validateScanConsistency(prisma, tenantId);

  return {
    ...report,
    validation,
  };
}

/**
 * Creates a scan schedule record in the database.
 */
export async function createScanSchedule(
  prisma: PrismaClient,
  tenantId: string,
  cronExpression: string,
  config: DiscoveryScanConfig
): Promise<string> {
  const encryptedConfig = encryptScanConfigCredentials(config);
  const schedule = await prisma.scanSchedule.create({
    data: {
      cronExpression,
      config: JSON.parse(JSON.stringify(encryptedConfig)),
      isActive: true,
      tenantId,
    },
  });
  return schedule.id;
}

/**
 * Lists scan schedules for a tenant.
 */
export async function listScanSchedules(
  prisma: PrismaClient,
  tenantId: string
) {
  const schedules = await prisma.scanSchedule.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });
  return schedules.map((schedule) => ({
    ...schedule,
    config: sanitizeScanConfig(schedule.config),
  }));
}

/**
 * Lists scan jobs for a tenant.
 */
export async function listScanJobs(
  prisma: PrismaClient,
  tenantId: string,
  limit = 20
) {
  return prisma.scanJob.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      progress: true,
      error: true,
    },
  });
}
