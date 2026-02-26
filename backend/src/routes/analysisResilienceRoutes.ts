import { appLogger } from "../utils/logger.js";
// ============================================================
// Analysis Resilience Routes — SPOF, redundancy, resilience score
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { calculateBlastRadius } from '../graph/blastRadiusEngine.js';
import type { InfraNodeAttrs } from '../graph/types.js';

const router = Router();

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveNodeTypeLabel(nodeType: string, metadata: Record<string, unknown> | undefined): string {
  const metadataLabel = readString(metadata?.awsService) ?? readString(metadata?.subType);
  return metadataLabel || nodeType;
}

// ─── POST /analysis/resilience — Run full graph analysis ──────────
router.post('/', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);

    if (graph.order === 0) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    const report = await analyzeFullGraph(graph);

    // Persist analysis
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

    const graphNodes = graph.nodes().map((id) => graph.getNodeAttributes(id) as InfraNodeAttrs);
    const graphEdges = graph.edges().map((edgeKey) => {
      const attrs = graph.getEdgeAttributes(edgeKey) as { type?: string };
      return {
        sourceId: graph.source(edgeKey),
        targetId: graph.target(edgeKey),
        type: String(attrs.type || ''),
      };
    });
    const blastByNodeId = new Map(
      calculateBlastRadius(graphNodes, graphEdges).map((entry) => [entry.nodeId, entry]),
    );

    // Update node scores in DB
    for (const [nodeId, score] of report.criticalityScores) {
      const spof = report.spofs.find(s => s.nodeId === nodeId);
      const blast = blastByNodeId.get(nodeId);
      const existingNode = graph.getNodeAttributes(nodeId) as InfraNodeAttrs;
      const existingMetadata =
        existingNode.metadata && typeof existingNode.metadata === 'object' && !Array.isArray(existingNode.metadata)
          ? (existingNode.metadata as Record<string, unknown>)
          : {};

      await prisma.infraNode.updateMany({
        where: { id: nodeId, tenantId },
        data: {
          criticalityScore: score,
          isSPOF: !!spof,
          blastRadius: blast?.transitiveDependents ?? 0,
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
          } as any,
        },
      });
    }

    return res.json({
      resilienceScore: report.resilienceScore,
      totalNodes: report.totalNodes,
      totalEdges: report.totalEdges,
      spofs: report.spofs,
      redundancyIssues: report.redundancyIssues,
      regionalRisks: report.regionalRisks,
      circularDeps: report.circularDeps,
      cascadeChains: report.cascadeChains.slice(0, 20),
    });
  } catch (error) {
    appLogger.error('Error running graph analysis:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /analysis/resilience/nodes/:nodeId — Per-node analysis detail ──────────
router.get('/nodes/:nodeId', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const nodeId = req.params.nodeId as string;
    const graph = await GraphService.getGraph(prisma, tenantId);

    if (!graph.hasNode(nodeId)) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const node = graph.getNodeAttributes(nodeId);
    const blastRadius = GraphService.getBlastRadius(graph, nodeId);

    // Check latest analysis for SPOF/redundancy status
    const latest = await prisma.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    let spofStatus = null;
    let redundancy = null;
    if (latest) {
      const report = latest.report as any;
      spofStatus = (report.spofs || []).find((s: any) => s.nodeId === nodeId) || null;
      redundancy = (report.redundancyIssues || []).find((r: any) => r.nodeId === nodeId) || null;
    }

    // Get DB node for computed scores
    const dbNode = await prisma.infraNode.findFirst({
      where: { id: nodeId, tenantId },
    });

    return res.json({
      node,
      spofStatus,
      redundancy,
      blastRadius: blastRadius.map(n => ({ id: n.id, name: n.name, type: n.type })),
      blastRadiusCount: blastRadius.length,
      scores: dbNode ? {
        criticalityScore: dbNode.criticalityScore,
        redundancyScore: dbNode.redundancyScore,
        betweennessCentrality: dbNode.betweennessCentrality,
        isSPOF: dbNode.isSPOF,
      } : null,
    });
  } catch (error) {
    appLogger.error('Error fetching node analysis:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /analysis/resilience/score — Latest resilience score ──────────
router.get('/score', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const latest = await prisma.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      return res.json({ overall: 0, breakdown: [], trend: undefined, lastCalculated: undefined });
    }

    const report = latest.report as any;

    // Build breakdown from analysis report data
    const breakdown: Array<{ category: string; impact: number; label: string; status: string }> = [];
    const spofCount = latest.spofCount || 0;
    const spofImpact = -Math.min(30, spofCount * 10);
    breakdown.push({
      category: 'spof',
      impact: spofImpact,
      label: `SPOF (${spofCount} detectes)`,
      status: spofCount === 0 ? 'ok' : spofCount <= 2 ? 'warning' : 'critical',
    });

    const redundancyIssues = (report.redundancyIssues || []).length;
    const redundancyImpact = -Math.min(25, redundancyIssues * 5);
    breakdown.push({
      category: 'redundancy',
      impact: redundancyImpact,
      label: `Redondance (${redundancyIssues} problemes)`,
      status: redundancyIssues === 0 ? 'ok' : redundancyIssues <= 3 ? 'warning' : 'critical',
    });

    const regionalRisks = (report.regionalRisks || []).length;
    const regionalImpact = -Math.min(15, regionalRisks * 5);
    breakdown.push({
      category: 'regional',
      impact: regionalImpact,
      label: `Concentration regionale (${regionalRisks} risques)`,
      status: regionalRisks === 0 ? 'ok' : regionalRisks <= 1 ? 'warning' : 'critical',
    });

    const circularDeps = (report.circularDeps || []).length;
    const circularImpact = -Math.min(10, circularDeps * 5);
    breakdown.push({
      category: 'circular',
      impact: circularImpact,
      label: `Dependencies circulaires (${circularDeps})`,
      status: circularDeps === 0 ? 'ok' : 'warning',
    });

    // Trend: delta from previous analysis
    const previous = await prisma.graphAnalysis.findFirst({
      where: { tenantId, createdAt: { lt: latest.createdAt } },
      orderBy: { createdAt: 'desc' },
    });
    const trend = previous ? latest.resilienceScore - previous.resilienceScore : undefined;

    return res.json({
      overall: latest.resilienceScore,
      breakdown,
      trend,
      lastCalculated: latest.createdAt.toISOString(),
    });
  } catch (error) {
    appLogger.error('Error fetching resilience score:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /analysis/resilience/blast-radius — Blast radius par service ──────────
router.get('/blast-radius', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);
    if (graph.order === 0) {
      return res.json([]);
    }

    const graphNodes = graph.nodes().map((id) => graph.getNodeAttributes(id) as InfraNodeAttrs);
    const graphEdges = graph.edges().map((edgeKey) => {
      const attrs = graph.getEdgeAttributes(edgeKey) as { type?: string };
      return {
        sourceId: graph.source(edgeKey),
        targetId: graph.target(edgeKey),
        type: String(attrs.type || ''),
      };
    });

    const blast = calculateBlastRadius(graphNodes, graphEdges)
      .sort((left, right) => right.transitiveDependents - left.transitiveDependents);

    return res.json(blast);
  } catch (error) {
    appLogger.error('Error fetching blast radius:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /analysis/resilience/spofs — List SPOFs ──────────
router.get('/spofs', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const latest = await prisma.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      return res.json([]);
    }

    const report = latest.report as any;
    const rawSpofs = Array.isArray(report.spofs) ? report.spofs : [];
    const spofNodeIds = rawSpofs
      .map((spof: any) => spof?.nodeId)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
    const infraNodes = spofNodeIds.length > 0
      ? await prisma.infraNode.findMany({
          where: { tenantId, id: { in: spofNodeIds } },
          select: { id: true, metadata: true },
        })
      : [];
    const metadataByNodeId = new Map<string, Record<string, unknown>>();
    for (const node of infraNodes) {
      if (node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)) {
        metadataByNodeId.set(node.id, node.metadata as Record<string, unknown>);
      }
    }

    let spofs = (report.spofs || []).map((s: any) => ({
      nodeId: s.nodeId,
      nodeName: s.nodeName,
      nodeType: resolveNodeTypeLabel(s.nodeType, metadataByNodeId.get(s.nodeId)),
      nodeTypeRaw: s.nodeType,
      blastRadius: s.blastRadius ?? 0,
      severity: s.severity,
      reasons: s.failedChecks?.map((c: any) => c.check || c) || [s.recommendation || 'SPOF detected'],
    }));

    // Filter by severity if requested
    const severity = req.query.severity as string;
    if (severity) {
      const allowed = severity.split(',');
      spofs = spofs.filter((s: any) => allowed.includes(s.severity));
    }

    return res.json(spofs);
  } catch (error) {
    appLogger.error('Error fetching SPOFs:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /analysis/resilience/redundancy-issues ──────────
router.get('/redundancy-issues', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const latest = await prisma.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      return res.json([]);
    }

    const report = latest.report as any;
    const rawIssues = Array.isArray(report.redundancyIssues) ? report.redundancyIssues : [];
    const issueNodeIds = rawIssues
      .map((issue: any) => issue?.nodeId)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);

    const infraNodes = issueNodeIds.length > 0
      ? await prisma.infraNode.findMany({
          where: { tenantId, id: { in: issueNodeIds } },
          select: { id: true, metadata: true },
        })
      : [];

    const metadataByNodeId = new Map<string, Record<string, unknown>>();
    for (const node of infraNodes) {
      if (node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)) {
        metadataByNodeId.set(node.id, node.metadata as Record<string, unknown>);
      }
    }

    const readBoolean = (value: unknown): boolean | null => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
      }
      return null;
    };

    const readNumber = (value: unknown): number | null => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const issues = rawIssues.map((issue: any) => {
      const failedChecks = Array.isArray(issue?.failedChecks) ? issue.failedChecks : [];
      const hasFailedCheck = (...names: string[]) =>
        failedChecks.some((check: any) => names.includes(String(check?.check || '')));
      const metadata = metadataByNodeId.get(issue.nodeId) || {};

      const metadataMultiAz =
        readBoolean(metadata.multiAZ) ??
        readBoolean(metadata.multiAz) ??
        readBoolean(metadata.multi_az) ??
        readBoolean(metadata.isMultiAZ);

      const replicas =
        readNumber(metadata.readReplicaCount) ??
        readNumber(metadata.readReplicas) ??
        readNumber(metadata.replicaCount) ??
        readNumber(metadata.replica_count) ??
        readNumber(metadata.replicas) ??
        readNumber(metadata.numCacheNodes) ??
        readNumber(metadata.num_cache_nodes) ??
        0;

      return {
        nodeId: issue.nodeId,
        nodeName: issue.nodeName,
        nodeType: resolveNodeTypeLabel(issue.nodeType, metadata),
        nodeTypeRaw: issue.nodeType,
        redundancyScore: issue.redundancyScore ?? 0,
        multiAZ: hasFailedCheck('multi_az', 'no_multi_az') ? false : (metadataMultiAz ?? true),
        replicas: Math.max(0, Math.floor(replicas)),
        hasBackup: hasFailedCheck('backup', 'no_backup') ? false : true,
        recommendations: failedChecks.map((c: any) => c?.recommendation || c?.check).filter(Boolean),
      };
    });
    return res.json(issues);
  } catch (error) {
    appLogger.error('Error fetching redundancy issues:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /analysis/resilience/regional-risks ──────────
router.get('/regional-risks', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const latest = await prisma.graphAnalysis.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      return res.json([]);
    }

    const report = latest.report as any;
    const risks = (report.regionalRisks || []).map((r: any) => ({
      region: r.region,
      provider: r.provider || 'aws',
      nodeCount: r.nodeCount ?? 0,
      criticalNodeCount: r.criticalNodeCount ?? 0,
      percentage: r.percentage ?? 0,
      risk: r.severity || r.risk || 'medium',
    }));
    return res.json(risks);
  } catch (error) {
    appLogger.error('Error fetching regional risks:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
