// ============================================================
// DiscoveryOrchestrator — Coordinates scanning + graph ingestion
// Bridges the existing discovery infrastructure with the
// new resilience graph engine.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import type { GraphAnalysisReport, IngestReport, InfraNodeAttrs, ScanEdge } from '../graph/types.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { inferDependencies } from '../graph/dependencyInferenceEngine.js';
import { calculateBlastRadius } from '../graph/blastRadiusEngine.js';
import { classifyServiceCriticality } from '../graph/criticalityClassifier.js';
import { transformToScanResult } from './graphBridge.js';
import { validateScanConsistency } from '../services/discoveryHealthService.js';
import { generateAndPersistBiaReport } from '../services/biaAutoGenerationService.js';
import { buildLandingZoneFinancialContext } from '../services/landing-zone-financial.service.js';
import type { DiscoveredResource, DiscoveredFlow } from '../services/discoveryTypes.js';
import { enrichAllNodes, type MetadataEnrichmentContext } from './enrichers/index.js';
import {
  encryptScanConfigCredentials,
  sanitizeScanConfig,
} from "../services/scanConfigSecurityService.js";
import { appLogger } from '../utils/logger.js';

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

function readNodeMetadata(node: InfraNodeAttrs): Record<string, unknown> {
  if (!node.metadata || typeof node.metadata !== 'object' || Array.isArray(node.metadata)) {
    return {};
  }
  return node.metadata as Record<string, unknown>;
}

async function persistLatestGraphAnalysis(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{
  analysisReport: GraphAnalysisReport | null;
  classificationUpdates: number;
}> {
  const graph = await GraphService.getGraph(prisma, tenantId);
  if (graph.order === 0) {
    return {
      analysisReport: null,
      classificationUpdates: 0,
    };
  }

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
  const graphNodes = graph.nodes().map((nodeId) => graph.getNodeAttributes(nodeId) as InfraNodeAttrs);
  const graphEdges = graph.edges().map((edgeKey) => {
    const edgeAttrs = graph.getEdgeAttributes(edgeKey) as { type?: string };
    return {
      sourceId: graph.source(edgeKey),
      targetId: graph.target(edgeKey),
      type: String(edgeAttrs.type || ''),
    };
  });
  const blastByNodeId = new Map(
    calculateBlastRadius(graphNodes, graphEdges).map((entry) => [entry.nodeId, entry]),
  );

  await Promise.all(
    Array.from(report.criticalityScores.entries()).map(async ([nodeId, score]) => {
      const blast = blastByNodeId.get(nodeId);
      const existingNode = graph.getNodeAttributes(nodeId) as InfraNodeAttrs;
      const existingMetadata = readNodeMetadata(existingNode);
      const classification = classifyServiceCriticality(existingNode, blast || null);

      await prisma.infraNode.updateMany({
        where: { id: nodeId, tenantId },
        data: {
          criticalityScore: score,
          isSPOF: spofIds.has(nodeId),
          blastRadius: blast?.transitiveDependents ?? 0,
          impactCategory: classification.impactCategory,
          metadata: {
            ...existingMetadata,
            blastRadiusDetails: blast
              ? {
                  directDependents: blast.directDependents,
                  transitiveDependents: blast.transitiveDependents,
                  totalServices: blast.totalServices,
                  impactRatio: blast.impactRatio,
                  impactedServices: blast.impactedServices,
                  rationale: blast.rationale,
                  calculatedAt: new Date().toISOString(),
                }
              : undefined,
            criticalityClassification: {
              tier: classification.tier,
              confidence: classification.confidence,
              signals: classification.signals,
              impactCategory: classification.impactCategory,
              source: 'auto_classifier',
              classifiedAt: new Date().toISOString(),
            },
          } as any,
        },
      });
    })
  );

  return {
    analysisReport: report,
    classificationUpdates: report.criticalityScores.size,
  };
}

export type PostIngestionPipelineResult = {
  inferredEdgesPersisted: number;
  analysisReport: GraphAnalysisReport | null;
  classificationUpdates: number;
};

type PostScanEnrichmentOptions = {
  logger?: Pick<typeof appLogger, 'info' | 'warn'>;
  autoGenerateBia?: false | ((tenantId: string) => Promise<unknown>);
  autoGenerateRecommendations?: false | ((tenantId: string) => Promise<{ recommendations?: unknown[] } | void>);
};

export type IngestDiscoveredResourcesOptions = {
  inferDependencies?: boolean;
  postScanEnrichments?: PostScanEnrichmentOptions;
  metadataEnrichment?: MetadataEnrichmentContext;
};

function hasMetadataEnrichmentCredentials(
  context: MetadataEnrichmentContext | undefined,
): context is MetadataEnrichmentContext {
  if (!context) return false;
  return Boolean(
    context.credentials.aws ||
      context.credentials.azure ||
      context.credentials.gcp,
  );
}

export async function runPostScanEnrichments(
  prisma: PrismaClient,
  tenantId: string,
  options?: PostScanEnrichmentOptions,
): Promise<void> {
  const logger = options?.logger ?? appLogger;
  const autoGenerateBia =
    options?.autoGenerateBia === false
      ? null
      : options?.autoGenerateBia ??
        ((currentTenantId: string) => generateAndPersistBiaReport(prisma, currentTenantId));
  const autoGenerateRecommendations =
    options?.autoGenerateRecommendations === false
      ? null
      : options?.autoGenerateRecommendations ??
        ((currentTenantId: string) => buildLandingZoneFinancialContext(prisma, currentTenantId));

  if (autoGenerateBia) {
    try {
      logger.info('[Discovery] Auto-generating BIA after scan...');
      const biaReport = await autoGenerateBia(tenantId);
      if (biaReport) {
        logger.info('[Discovery] BIA auto-generated successfully');
      } else {
        logger.info('[Discovery] BIA auto-generation skipped because graph is empty');
      }
    } catch (error) {
      logger.warn('[Discovery] BIA auto-generation failed, can be triggered manually', error);
    }
  }

  if (autoGenerateRecommendations) {
    try {
      logger.info('[Discovery] Auto-generating recommendations after scan...');
      const recommendationContext = await autoGenerateRecommendations(tenantId);
      const count = Array.isArray((recommendationContext as { recommendations?: unknown[] } | undefined)?.recommendations)
        ? (recommendationContext as { recommendations?: unknown[] }).recommendations?.length
        : undefined;
      logger.info('[Discovery] Recommendations auto-generated successfully', {
        tenantId,
        ...(typeof count === 'number' ? { recommendations: count } : {}),
      });
    } catch (error) {
      logger.warn('[Discovery] Recommendations auto-generation failed', error);
    }
  }
}

export async function runPostIngestionPipeline(
  prisma: PrismaClient,
  tenantId: string,
  options?: {
    inferDependencies?: boolean;
    postScanEnrichments?: PostScanEnrichmentOptions;
  },
): Promise<PostIngestionPipelineResult> {
  let inferredEdgesPersisted = 0;

  if (options?.inferDependencies === true) {
    const [nodesFromDb, edgesFromDb] = await Promise.all([
      prisma.infraNode.findMany({ where: { tenantId } }),
      prisma.infraEdge.findMany({ where: { tenantId } }),
    ]);

    const inferenceNodes: InfraNodeAttrs[] = nodesFromDb.map((node) => {
      const mapped: InfraNodeAttrs = {
        id: node.id,
        name: node.name,
        type: node.type,
        provider: node.provider,
        tags: (node.tags as Record<string, string>) || {},
        metadata: (node.metadata as Record<string, unknown>) || {},
      };
      if (node.externalId) mapped.externalId = node.externalId;
      if (node.region) mapped.region = node.region;
      if (node.availabilityZone) mapped.availabilityZone = node.availabilityZone;
      if (node.criticalityScore != null) mapped.criticalityScore = node.criticalityScore;
      if (node.blastRadius != null) mapped.blastRadius = node.blastRadius;
      if (node.isSPOF === true) mapped.isSPOF = true;
      if (node.impactCategory) mapped.impactCategory = node.impactCategory;
      return mapped;
    });

    const existingEdges: ScanEdge[] = edgesFromDb.map((edge) => {
      const mapped: ScanEdge = {
        source: edge.sourceId,
        target: edge.targetId,
        type: edge.type,
      };
      if (Number.isFinite(edge.confidence)) mapped.confidence = edge.confidence;
      if (edge.inferenceMethod) mapped.inferenceMethod = edge.inferenceMethod;
      if (edge.metadata && typeof edge.metadata === 'object' && !Array.isArray(edge.metadata)) {
        mapped.metadata = edge.metadata as Record<string, unknown>;
      }
      return mapped;
    });

    const inferredEdges = inferDependencies(inferenceNodes, existingEdges);
    if (inferredEdges.length > 0) {
      const created = await prisma.infraEdge.createMany({
        data: inferredEdges.map((edge) => ({
          sourceId: edge.source,
          targetId: edge.target,
          type: edge.type,
          confidence: Number.isFinite(edge.confidence) ? Number(edge.confidence) : 0.7,
          inferenceMethod: edge.inferenceMethod ?? null,
          metadata: (edge.metadata || {}) as any,
          confirmed: false,
          tenantId,
        })),
        skipDuplicates: true,
      });
      inferredEdgesPersisted = created.count;
    }
  }

  // Always refresh graph and recompute analysis/classification after ingest.
  await GraphService.loadGraphFromDB(prisma, tenantId);
  const analysisResult = await persistLatestGraphAnalysis(prisma, tenantId);
  await runPostScanEnrichments(prisma, tenantId, options?.postScanEnrichments);

  return {
    inferredEdgesPersisted,
    analysisReport: analysisResult.analysisReport,
    classificationUpdates: analysisResult.classificationUpdates,
  };
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
  options?: IngestDiscoveredResourcesOptions
): Promise<IngestReport> {
  // 1. Transform discovered resources to ScanResult format
  const scanResult = transformToScanResult(resources, flows, provider);

  if (hasMetadataEnrichmentCredentials(options?.metadataEnrichment)) {
    try {
      const enrichmentResults = await enrichAllNodes(
        scanResult.nodes,
        options.metadataEnrichment.credentials,
        options.metadataEnrichment.regions,
      );
      appLogger.info('[Discovery] Metadata enrichment complete', {
        tenantId,
        provider,
        enrichers: enrichmentResults,
      });
    } catch (error) {
      appLogger.debug('[Discovery] Metadata enrichment failed', {
        tenantId,
        provider,
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  // 2. Optionally run dependency inference
  if (options?.inferDependencies !== false) {
    const inferredEdges = inferDependencies(scanResult.nodes, scanResult.edges);
    scanResult.edges = [...scanResult.edges, ...inferredEdges];
  }

  // 3. Ingest into the resilience graph via GraphService
  const report = await GraphService.ingestScanResults(prisma, tenantId, scanResult);

  // 4. Refresh resilience analysis so dashboard metrics stay in sync with latest scan.
  await runPostIngestionPipeline(prisma, tenantId, {
    inferDependencies: false,
    ...(options?.postScanEnrichments
      ? { postScanEnrichments: options.postScanEnrichments }
      : {}),
  });

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
