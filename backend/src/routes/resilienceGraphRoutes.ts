import { appLogger } from "../utils/logger.js";
// ============================================================
// Resilience Graph Routes — InfraNode graph + analysis endpoints
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { NodeType, EdgeType } from '../graph/types.js';

const router = Router();

// ─── GET /resilience/graph — Full infrastructure graph ──────────
router.get('/graph', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);
    const data = GraphService.exportForVisualization(graph);
    const stats = GraphService.getGraphStats(graph);

    return res.json({ ...data, stats });
  } catch (error) {
    appLogger.error('Error fetching resilience graph:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /resilience/graph/stats — Graph statistics ──────────
router.get('/graph/stats', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const graph = await GraphService.getGraph(prisma, tenantId);
    return res.json(GraphService.getGraphStats(graph));
  } catch (error) {
    appLogger.error('Error fetching graph stats:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /resilience/graph/nodes/:nodeId — Node detail with subgraph ──────────
router.get('/graph/nodes/:nodeId', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const nodeId = req.params.nodeId as string;
    const depth = parseInt(req.query.depth as string) || 2;
    const graph = await GraphService.getGraph(prisma, tenantId);

    if (!graph.hasNode(nodeId)) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const node = graph.getNodeAttributes(nodeId);
    const subgraph = GraphService.getSubgraph(graph, nodeId, depth);
    const dependencies = GraphService.getDependencies(graph, nodeId);
    const dependents = GraphService.getDependents(graph, nodeId);
    const blastRadius = GraphService.getBlastRadius(graph, nodeId);

    return res.json({
      node,
      subgraph,
      dependencies,
      dependents,
      blastRadius: blastRadius.map(n => ({ id: n.id, name: n.name, type: n.type })),
      blastRadiusCount: blastRadius.length,
    });
  } catch (error) {
    appLogger.error('Error fetching node detail:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /resilience/graph/blast-radius/:nodeId ──────────
router.get('/graph/blast-radius/:nodeId', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const nodeId = req.params.nodeId as string;
    const graph = await GraphService.getGraph(prisma, tenantId);

    if (!graph.hasNode(nodeId)) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const blastRadius = GraphService.getBlastRadius(graph, nodeId);
    return res.json({
      sourceNodeId: nodeId,
      impactedNodes: blastRadius.map(n => ({
        id: n.id,
        name: n.name,
        type: n.type,
        region: n.region,
      })),
      totalImpacted: blastRadius.length,
    });
  } catch (error) {
    appLogger.error('Error computing blast radius:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /resilience/graph/nodes — Manually add a node ──────────
router.post('/graph/nodes', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { name, type, provider, region, availabilityZone, tags, metadata, externalId } = req.body;

    if (!name || !type || !provider) {
      return res.status(400).json({ error: 'name, type, and provider are required' });
    }

    const node = await prisma.infraNode.create({
      data: {
        name,
        type,
        provider,
        region: region || null,
        availabilityZone: availabilityZone || null,
        tags: tags || {},
        metadata: metadata || {},
        externalId: externalId || null,
        tenantId,
        lastSeenAt: new Date(),
      },
    });

    // Reload graph
    await GraphService.loadGraphFromDB(prisma, tenantId);

    return res.status(201).json(node);
  } catch (error) {
    appLogger.error('Error creating node:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /resilience/graph/edges — Manually add an edge ──────────
router.post('/graph/edges', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { sourceId, targetId, type, confidence, inferenceMethod } = req.body;

    if (!sourceId || !targetId || !type) {
      return res.status(400).json({ error: 'sourceId, targetId, and type are required' });
    }

    const edge = await prisma.infraEdge.create({
      data: {
        sourceId,
        targetId,
        type,
        confidence: confidence ?? 1.0,
        inferenceMethod: inferenceMethod || 'manual',
        confirmed: true,
        tenantId,
      },
    });

    await GraphService.loadGraphFromDB(prisma, tenantId);

    return res.status(201).json(edge);
  } catch (error) {
    appLogger.error('Error creating edge:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /resilience/graph/edges/:edgeId — Confirm/reject inferred edge ──────────
router.patch('/graph/edges/:edgeId', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const edgeId = req.params.edgeId as string;
    const { confirmed } = req.body;

    if (typeof confirmed !== 'boolean') {
      return res.status(400).json({ error: 'confirmed (boolean) is required' });
    }

    // Verify edge belongs to this tenant before modifying
    const existingEdge = await prisma.infraEdge.findFirst({
      where: { id: edgeId, tenantId },
    });
    if (!existingEdge) {
      return res.status(404).json({ error: 'Edge not found' });
    }

    if (!confirmed) {
      // Reject — delete the edge
      await prisma.infraEdge.deleteMany({ where: { id: edgeId, tenantId } });
      await GraphService.loadGraphFromDB(prisma, tenantId);
      return res.json({ deleted: true });
    }

    const edge = await prisma.infraEdge.update({
      where: { id: edgeId },
      data: { confirmed: true },
    });

    await GraphService.loadGraphFromDB(prisma, tenantId);
    return res.json(edge);
  } catch (error) {
    appLogger.error('Error updating edge:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /resilience/graph/ingest — Ingest scan results ──────────
router.post('/graph/ingest', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const { nodes, edges, provider } = req.body;

    if (!nodes || !Array.isArray(nodes)) {
      return res.status(400).json({ error: 'nodes array is required' });
    }

    const report = await GraphService.ingestScanResults(prisma, tenantId, {
      nodes,
      edges: edges || [],
      provider: provider || 'manual',
      scannedAt: new Date(),
    });

    return res.json(report);
  } catch (error) {
    appLogger.error('Error ingesting scan results:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /resilience/graph/enums — Available node/edge types ──────────
router.get('/graph/enums', async (_req: TenantRequest, res) => {
  return res.json({
    nodeTypes: Object.values(NodeType),
    edgeTypes: Object.values(EdgeType),
  });
});

export default router;
