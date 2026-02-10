// ============================================================
// DiscoveryOrchestrator — Coordinates scanning + graph ingestion
// Bridges the existing discovery infrastructure with the
// new resilience graph engine.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import type { IngestReport } from '../graph/types.js';
import * as GraphService from '../graph/graphService.js';
import { inferDependencies } from '../graph/dependencyInferenceEngine.js';
import { transformToScanResult } from './graphBridge.js';
import { validateScanConsistency } from '../services/discoveryHealthService.js';
import type { DiscoveredResource, DiscoveredFlow } from '../services/discoveryTypes.js';

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
  const job = await prisma.scanJob.create({
    data: {
      status: 'queued',
      config: JSON.parse(JSON.stringify(config)),
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

  // 4. Run post-scan validation checks automatically
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
  const schedule = await prisma.scanSchedule.create({
    data: {
      cronExpression,
      config: JSON.parse(JSON.stringify(config)),
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
  return prisma.scanSchedule.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });
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
