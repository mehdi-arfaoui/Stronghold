// ============================================================
// Drift Detection Service - Compare infrastructure snapshots
// ============================================================

import { createHash } from 'crypto';
import type { InfraEdge, InfraNode, Prisma, PrismaClient } from '@prisma/client';

export type DriftComparisonMode = 'baseline' | 'latest';

export interface DriftEventInput {
  type: 'node_added' | 'node_removed' | 'node_modified' | 'edge_added' | 'edge_removed' | 'config_changed';
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'availability' | 'compliance' | 'capacity';
  nodeId?: string;
  nodeName?: string;
  nodeType?: string;
  description: string;
  details: Record<string, unknown>;
  affectsBIA: boolean;
  affectsRTO: boolean;
  affectsSPOF: boolean;
}

export interface DriftCheckResult {
  snapshot: { id: string; nodeCount: number; edgeCount: number; nodesHash: string };
  drifts: DriftEventInput[];
  resilienceScore: { current: number; previous: number; delta: number };
  comparisonMode: DriftComparisonMode;
  baselineSnapshotId: string | null;
  comparedSnapshotId: string | null;
}

type SnapshotMetadata = {
  capturedAt?: string;
  nodeTypes?: Record<string, number>;
  providers?: Record<string, number>;
  regions?: Record<string, number>;
  spofNodeIds?: string[];
  isBaseline?: boolean;
  baselineLabel?: string;
};

function readMetadataObject(value: Prisma.JsonValue | null): SnapshotMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as SnapshotMetadata;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function readCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const map = value as Record<string, unknown>;
  const normalized: Record<string, number> = {};
  for (const [key, count] of Object.entries(map)) {
    const numeric = Number(count);
    if (Number.isFinite(numeric) && numeric > 0) {
      normalized[key] = numeric;
    }
  }
  return normalized;
}

/**
 * Capture a snapshot of the current infrastructure graph.
 */
export async function captureSnapshot(
  prisma: PrismaClient,
  tenantId: string,
  scanId?: string,
  options?: { isBaseline?: boolean; baselineLabel?: string },
) {
  const nodes = await prisma.infraNode.findMany({
    where: { tenantId },
    orderBy: { id: 'asc' },
  });

  const edges = await prisma.infraEdge.findMany({
    where: { tenantId },
    orderBy: { id: 'asc' },
  });

  const nodesHash = hashGraph(nodes, edges);
  const spofNodeIds = nodes.filter((node) => node.isSPOF).map((node) => node.id);

  const metadata: SnapshotMetadata = {
    capturedAt: new Date().toISOString(),
    nodeTypes: countByField(nodes, 'type'),
    providers: countByField(nodes, 'provider'),
    regions: countByField(nodes, 'region'),
    spofNodeIds,
    isBaseline: Boolean(options?.isBaseline),
    ...(options?.baselineLabel ? { baselineLabel: options.baselineLabel } : {}),
  };

  return prisma.infraSnapshot.create({
    data: {
      tenantId,
      scanId: scanId ?? null,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodesHash,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

/**
 * Ensure a baseline snapshot exists for tenant drift comparison.
 */
export async function ensureBaselineSnapshot(prisma: PrismaClient, tenantId: string, baselineLabel = 'baseline') {
  const firstSnapshot = await prisma.infraSnapshot.findFirst({
    where: { tenantId },
    orderBy: { capturedAt: 'asc' },
  });

  if (!firstSnapshot) {
    return captureSnapshot(prisma, tenantId, undefined, { isBaseline: true, baselineLabel });
  }

  const metadata = readMetadataObject(firstSnapshot.metadata);
  if (!metadata.isBaseline) {
    const updatedMetadata: SnapshotMetadata = {
      ...metadata,
      isBaseline: true,
      baselineLabel: metadata.baselineLabel ?? baselineLabel,
    };

    await prisma.infraSnapshot.updateMany({
      where: { id: firstSnapshot.id, tenantId },
      data: { metadata: updatedMetadata as Prisma.InputJsonValue },
    });
  }

  return firstSnapshot;
}

/**
 * Compare two snapshots and generate drift events.
 */
export async function detectDrifts(
  prisma: PrismaClient,
  tenantId: string,
  previousSnapshotId: string,
  currentSnapshotId: string,
): Promise<DriftEventInput[]> {
  const previousSnapshot = await prisma.infraSnapshot.findFirst({
    where: { id: previousSnapshotId, tenantId },
  });
  const currentSnapshot = await prisma.infraSnapshot.findFirst({
    where: { id: currentSnapshotId, tenantId },
  });

  if (!previousSnapshot || !currentSnapshot) return [];
  if (previousSnapshot.nodesHash === currentSnapshot.nodesHash) return [];

  const nodes = await prisma.infraNode.findMany({ where: { tenantId } });
  const drifts: DriftEventInput[] = [];

  const nodeDelta = currentSnapshot.nodeCount - previousSnapshot.nodeCount;
  const edgeDelta = currentSnapshot.edgeCount - previousSnapshot.edgeCount;

  if (nodeDelta > 0) {
    drifts.push({
      type: 'node_added',
      severity: 'medium',
      category: 'capacity',
      description: `${nodeDelta} nouveau(x) service(s) detecte(s) depuis le snapshot compare`,
      details: { previousCount: previousSnapshot.nodeCount, currentCount: currentSnapshot.nodeCount },
      affectsBIA: true,
      affectsRTO: false,
      affectsSPOF: false,
    });
  }

  if (nodeDelta < 0) {
    drifts.push({
      type: 'node_removed',
      severity: 'high',
      category: 'availability',
      description: `${Math.abs(nodeDelta)} service(s) supprime(s) depuis le snapshot compare`,
      details: { previousCount: previousSnapshot.nodeCount, currentCount: currentSnapshot.nodeCount },
      affectsBIA: true,
      affectsRTO: true,
      affectsSPOF: true,
    });
  }

  if (edgeDelta !== 0) {
    drifts.push({
      type: edgeDelta > 0 ? 'edge_added' : 'edge_removed',
      severity: 'medium',
      category: 'availability',
      description: `${Math.abs(edgeDelta)} dependance(s) ${edgeDelta > 0 ? 'ajoutee(s)' : 'supprimee(s)'}`,
      details: { previousCount: previousSnapshot.edgeCount, currentCount: currentSnapshot.edgeCount },
      affectsBIA: false,
      affectsRTO: false,
      affectsSPOF: edgeDelta < 0,
    });
  }

  const previousMetadata = readMetadataObject(previousSnapshot.metadata);
  const previousSpofIds = new Set(readStringArray(previousMetadata.spofNodeIds));
  const currentSpofs = nodes.filter((node) => node.isSPOF);
  const newSpofs = currentSpofs.filter((node) => !previousSpofIds.has(node.id));

  for (const spof of newSpofs) {
    drifts.push({
      type: 'config_changed',
      severity: 'critical',
      category: 'availability',
      nodeId: spof.id,
      nodeName: spof.name,
      nodeType: spof.type,
      description: `Nouveau SPOF detecte: ${spof.name} (${spof.type})`,
      details: {
        isSPOF: true,
        criticalityScore: spof.criticalityScore,
        comparedSnapshotId: previousSnapshotId,
      },
      affectsBIA: true,
      affectsRTO: true,
      affectsSPOF: true,
    });
  }

  const previousRegions = readCountMap(previousMetadata.regions);
  const currentRegionMap = countByField(nodes, 'region');
  const previousRegionsUsed = Object.keys(previousRegions).filter((region) => region !== 'unknown');
  const currentRegionsUsed = Object.keys(currentRegionMap).filter((region) => region !== 'unknown');

  if (nodes.length > 5 && currentRegionsUsed.length === 1) {
    const currentRegion = currentRegionsUsed[0];
    const previousSingleRegion = previousRegionsUsed.length === 1 ? previousRegionsUsed[0] : null;
    if (!previousSingleRegion || previousSingleRegion !== currentRegion) {
      drifts.push({
        type: 'config_changed',
        severity: 'high',
        category: 'availability',
        description: `Concentration regionale detectee: ${nodes.length} noeuds sur ${currentRegion}`,
        details: {
          region: currentRegion,
          nodeCount: currentRegion ? currentRegionMap[currentRegion] ?? 0 : 0,
          totalNodes: nodes.length,
        },
        affectsBIA: false,
        affectsRTO: true,
        affectsSPOF: false,
      });
    }
  }

  return drifts;
}

/**
 * Run a full drift check with selectable comparison mode.
 */
export async function runDriftCheck(
  prisma: PrismaClient,
  tenantId: string,
  options?: { comparisonMode?: DriftComparisonMode; scanId?: string },
): Promise<DriftCheckResult> {
  const comparisonMode = options?.comparisonMode ?? 'baseline';
  const baselineSnapshot = await ensureBaselineSnapshot(prisma, tenantId, 'drift-baseline');
  const currentSnapshot = await captureSnapshot(prisma, tenantId, options?.scanId);

  let comparedSnapshotId: string | null = null;
  if (comparisonMode === 'baseline') {
    comparedSnapshotId = baselineSnapshot.id;
  } else {
    const previousSnapshot = await prisma.infraSnapshot.findFirst({
      where: { tenantId, id: { not: currentSnapshot.id } },
      orderBy: { capturedAt: 'desc' },
    });
    comparedSnapshotId = previousSnapshot?.id ?? null;
  }

  let drifts: DriftEventInput[] = [];
  if (comparedSnapshotId && comparedSnapshotId !== currentSnapshot.id) {
    drifts = await detectDrifts(prisma, tenantId, comparedSnapshotId, currentSnapshot.id);

    if (drifts.length > 0) {
      await prisma.driftEvent.createMany({
        data: drifts.map((drift) => ({
          tenantId,
          snapshotId: currentSnapshot.id,
          type: drift.type,
          severity: drift.severity,
          category: drift.category,
          nodeId: drift.nodeId ?? null,
          nodeName: drift.nodeName ?? null,
          nodeType: drift.nodeType ?? null,
          description: drift.description,
          details: drift.details as Prisma.InputJsonValue,
          affectsBIA: drift.affectsBIA,
          affectsRTO: drift.affectsRTO,
          affectsSPOF: drift.affectsSPOF,
        })),
      });
    }
  }

  const currentScore = await calculateResilienceScore(prisma, tenantId);
  const previousAnalysis = await prisma.graphAnalysis.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    skip: 1,
  });
  const previousScore = previousAnalysis?.resilienceScore ?? currentScore;

  return {
    snapshot: {
      id: currentSnapshot.id,
      nodeCount: currentSnapshot.nodeCount,
      edgeCount: currentSnapshot.edgeCount,
      nodesHash: currentSnapshot.nodesHash,
    },
    drifts,
    resilienceScore: {
      current: currentScore,
      previous: previousScore,
      delta: currentScore - previousScore,
    },
    comparisonMode,
    baselineSnapshotId: baselineSnapshot.id,
    comparedSnapshotId,
  };
}

/**
 * Calculate resilience score (0-100).
 */
export async function calculateResilienceScore(prisma: PrismaClient, tenantId: string): Promise<number> {
  let score = 100;

  const spofCount = await prisma.infraNode.count({ where: { tenantId, isSPOF: true } });
  score -= spofCount * 10;

  const criticalNodes = await prisma.infraNode.findMany({
    where: {
      tenantId,
      OR: [
        { criticalityScore: { gt: 80 }, redundancyScore: { lt: 30 } },
        { criticalityScore: { gt: 0.8, lte: 1 }, redundancyScore: { lt: 0.3 } },
      ],
    },
  });
  score -= criticalNodes.length * 3;

  const totalNodes = await prisma.infraNode.count({ where: { tenantId } });
  const biaReport = await prisma.bIAReport2.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: { processes: true },
  });
  const biaCoverage = totalNodes > 0 && biaReport ? biaReport.processes.length / totalNodes : 0;
  score -= Math.round((1 - biaCoverage) * 20);

  const openDrifts = await prisma.driftEvent.groupBy({
    by: ['severity'],
    where: { tenantId, status: 'open' },
    _count: true,
  });
  for (const drift of openDrifts) {
    if (drift.severity === 'critical') score -= drift._count * 5;
    else if (drift.severity === 'high') score -= drift._count * 2;
    else if (drift.severity === 'medium') score -= drift._count * 1;
  }

  const recentExercise = await prisma.exerciseResult.findFirst({
    where: {
      exercise: { tenantId },
      status: 'completed',
      completedAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
  });
  if (recentExercise) score += 5;

  return Math.max(0, Math.min(100, score));
}

function hashGraph(nodes: InfraNode[], edges: InfraEdge[]): string {
  const data = JSON.stringify({
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      provider: node.provider,
      region: node.region,
      isSPOF: node.isSPOF,
    })),
    edges: edges.map((edge) => ({ source: edge.sourceId, target: edge.targetId, type: edge.type })),
  });

  return createHash('sha256').update(data).digest('hex');
}

function countByField(items: InfraNode[], field: 'type' | 'provider' | 'region'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const rawValue = item[field];
    const key = (typeof rawValue === 'string' && rawValue.trim().length > 0 ? rawValue : 'unknown').toLowerCase();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}



