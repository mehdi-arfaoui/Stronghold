// ============================================================
// Drift Detection Service — Compare infrastructure snapshots
// ============================================================

import { createHash } from 'crypto';
import type { PrismaClient, InfraNode, InfraEdge } from '@prisma/client';

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
}

/**
 * Capture a snapshot of the current infrastructure graph
 */
export async function captureSnapshot(prisma: PrismaClient, tenantId: string, scanId?: string) {
  const nodes = await prisma.infraNode.findMany({
    where: { tenantId },
    orderBy: { id: 'asc' },
  });

  const edges = await prisma.infraEdge.findMany({
    where: { tenantId },
    orderBy: { id: 'asc' },
  });

  const nodesHash = hashGraph(nodes, edges);

  const snapshot = await prisma.infraSnapshot.create({
    data: {
      tenantId,
      scanId: scanId ?? null,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodesHash,
      metadata: {
        capturedAt: new Date().toISOString(),
        nodeTypes: countByField(nodes, 'type'),
        providers: countByField(nodes, 'provider'),
      },
    },
  });

  return snapshot;
}

/**
 * Compare two snapshots and generate drift events
 */
export async function detectDrifts(
  prisma: PrismaClient,
  tenantId: string,
  previousSnapshotId: string,
  currentSnapshotId: string,
): Promise<DriftEventInput[]> {
  // Load nodes at time of each snapshot - use current state as proxy
  // In production, snapshots would store full node data
  const prevSnapshot = await prisma.infraSnapshot.findUnique({ where: { id: previousSnapshotId } });
  const currSnapshot = await prisma.infraSnapshot.findUnique({ where: { id: currentSnapshotId } });

  if (!prevSnapshot || !currSnapshot) return [];

  // If hashes match, no drift
  if (prevSnapshot.nodesHash === currSnapshot.nodesHash) return [];

  // Load current graph data
  const nodes = await prisma.infraNode.findMany({ where: { tenantId } });
  const edges = await prisma.infraEdge.findMany({ where: { tenantId } });

  const drifts: DriftEventInput[] = [];

  // Detect node count changes
  const nodeDelta = currSnapshot.nodeCount - prevSnapshot.nodeCount;
  const edgeDelta = currSnapshot.edgeCount - prevSnapshot.edgeCount;

  if (nodeDelta > 0) {
    drifts.push({
      type: 'node_added',
      severity: 'medium',
      category: 'capacity',
      description: `${nodeDelta} nouveau(x) service(s) detecte(s) depuis le dernier scan`,
      details: { previousCount: prevSnapshot.nodeCount, currentCount: currSnapshot.nodeCount },
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
      description: `${Math.abs(nodeDelta)} service(s) supprime(s) depuis le dernier scan`,
      details: { previousCount: prevSnapshot.nodeCount, currentCount: currSnapshot.nodeCount },
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
      details: { previousCount: prevSnapshot.edgeCount, currentCount: currSnapshot.edgeCount },
      affectsBIA: false,
      affectsRTO: false,
      affectsSPOF: edgeDelta < 0,
    });
  }

  // Check for new SPOFs
  const currentSpofs = nodes.filter(n => n.isSPOF);
  for (const spof of currentSpofs) {
    drifts.push({
      type: 'config_changed',
      severity: 'critical',
      category: 'availability',
      nodeId: spof.id,
      nodeName: spof.name,
      nodeType: spof.type,
      description: `SPOF detecte: ${spof.name} (${spof.type}) - services dependants`,
      details: { isSPOF: true, criticalityScore: spof.criticalityScore },
      affectsBIA: true,
      affectsRTO: true,
      affectsSPOF: true,
    });
  }

  // Check single-region concentration
  const regions = new Map<string, number>();
  for (const node of nodes) {
    if (node.region) {
      regions.set(node.region, (regions.get(node.region) ?? 0) + 1);
    }
  }
  const regionEntries = [...regions.entries()];
  const firstEntry = regionEntries[0];
  if (regionEntries.length === 1 && firstEntry && nodes.length > 5) {
    drifts.push({
      type: 'config_changed',
      severity: 'high',
      category: 'availability',
      description: `Tous les services (${nodes.length}) concentres dans une seule region: ${firstEntry[0]}`,
      details: { region: firstEntry[0], nodeCount: firstEntry[1] },
      affectsBIA: false,
      affectsRTO: true,
      affectsSPOF: false,
    });
  }

  return drifts;
}

/**
 * Run a full drift check: capture snapshot, compare, persist events
 */
export async function runDriftCheck(prisma: PrismaClient, tenantId: string): Promise<DriftCheckResult> {
  // Get previous snapshot
  const previousSnapshot = await prisma.infraSnapshot.findFirst({
    where: { tenantId },
    orderBy: { capturedAt: 'desc' },
  });

  // Capture new snapshot
  const currentSnapshot = await captureSnapshot(prisma, tenantId);

  let drifts: DriftEventInput[] = [];

  if (previousSnapshot) {
    drifts = await detectDrifts(prisma, tenantId, previousSnapshot.id, currentSnapshot.id);

    // Persist drift events
    for (const drift of drifts) {
      await prisma.driftEvent.create({
        data: {
          tenantId,
          snapshotId: currentSnapshot.id,
          type: drift.type,
          severity: drift.severity,
          category: drift.category,
          nodeId: drift.nodeId ?? null,
          nodeName: drift.nodeName ?? null,
          nodeType: drift.nodeType ?? null,
          description: drift.description,
          details: drift.details as any,
          affectsBIA: drift.affectsBIA,
          affectsRTO: drift.affectsRTO,
          affectsSPOF: drift.affectsSPOF,
        },
      });
    }
  }

  // Calculate resilience score
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
  };
}

/**
 * Calculate resilience score (0-100)
 */
export async function calculateResilienceScore(prisma: PrismaClient, tenantId: string): Promise<number> {
  let score = 100;

  // SPOF penalty
  const spofCount = await prisma.infraNode.count({ where: { tenantId, isSPOF: true } });
  score -= spofCount * 10;

  // Critical nodes without redundancy
  const criticalNodes = await prisma.infraNode.findMany({
    where: { tenantId, criticalityScore: { gt: 0.8 }, redundancyScore: { lt: 0.3 } },
  });
  score -= criticalNodes.length * 3;

  // BIA completeness
  const totalNodes = await prisma.infraNode.count({ where: { tenantId } });
  const biaReport = await prisma.bIAReport2.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: { processes: true },
  });
  const biaCoverage = totalNodes > 0 && biaReport
    ? biaReport.processes.length / totalNodes
    : 0;
  score -= Math.round((1 - biaCoverage) * 20);

  // Unresolved drift penalty
  const openDrifts = await prisma.driftEvent.groupBy({
    by: ['severity'],
    where: { tenantId, status: 'open' },
    _count: true,
  });
  for (const d of openDrifts) {
    if (d.severity === 'critical') score -= d._count * 5;
    else if (d.severity === 'high') score -= d._count * 2;
    else if (d.severity === 'medium') score -= d._count * 1;
  }

  // Exercise bonus
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

// ─── Helpers ──────────

function hashGraph(nodes: InfraNode[], edges: InfraEdge[]): string {
  const data = JSON.stringify({
    nodes: nodes.map(n => ({ id: n.id, name: n.name, type: n.type, provider: n.provider, region: n.region })),
    edges: edges.map(e => ({ source: e.sourceId, target: e.targetId, type: e.type })),
  });
  return createHash('sha256').update(data).digest('hex');
}

function countByField(items: any[], field: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const val = item[field] ?? 'unknown';
    counts[val] = (counts[val] ?? 0) + 1;
  }
  return counts;
}
