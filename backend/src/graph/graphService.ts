// ============================================================
// GraphService — Central graph engine using graphology
// ============================================================

import GraphLib from 'graphology';
import type { PrismaClient } from '@prisma/client';
import type {
  InfraNodeAttrs,
  InfraEdgeAttrs,
  ScanResult,
  IngestReport,
  CascadeNode,
  CriticalPath,
} from './types.js';

// Graphology type: use the imported class directly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GraphClass = (GraphLib as any).Graph || (GraphLib as any).default || GraphLib;

/** The graph instance type used throughout the resilience platform */
export interface GraphInstance {
  order: number;
  size: number;
  addNode(key: string, attrs?: Record<string, unknown>): string;
  addEdgeWithKey(key: string, source: string, target: string, attrs?: Record<string, unknown>): string;
  hasNode(key: string): boolean;
  hasEdge(key: string): boolean;
  dropEdge(key: string): void;
  getNodeAttributes(key: string): any;
  getEdgeAttributes(key: string): any;
  setNodeAttribute(key: string, attr: string, value: unknown): void;
  outNeighbors(key: string): string[];
  inNeighbors(key: string): string[];
  outEdges(key: string): string[];
  inDegree(key: string): number;
  outDegree(key: string): number;
  nodes(): string[];
  edges(): string[];
  source(edge: string): string;
  target(edge: string): string;
  forEachNode(callback: (key: string, attrs: any) => void): void;
  forEachEdge(key: string | ((key: string, attrs: any, source: string, target: string, sourceAttrs: any, targetAttrs: any) => void), callback?: (key: string, attrs: any, source: string, target: string, sourceAttrs: any, targetAttrs: any) => void): void;
  copy(): GraphInstance;
}

// In-memory graph instances keyed by tenantId
const graphInstances = new Map<string, GraphInstance>();

const logInfo = (event: string, metadata: Record<string, unknown> = {}) => {
  console.info(JSON.stringify({ level: 'info', scope: 'graph.service', event, ...metadata }));
};

function createGraph(): GraphInstance {
  return new GraphClass({ type: 'directed', multi: false, allowSelfLoops: false }) as GraphInstance;
}

// --- Load graph from DB ---
export async function loadGraphFromDB(prisma: PrismaClient, tenantId: string): Promise<GraphInstance> {
  const graph = createGraph();

  const nodes = await prisma.infraNode.findMany({ where: { tenantId } });
  const edges = await prisma.infraEdge.findMany({ where: { tenantId } });

  for (const node of nodes) {
    const attrs: Record<string, unknown> = {
      id: node.id,
      externalId: node.externalId,
      name: node.name,
      type: node.type,
      provider: node.provider,
      region: node.region,
      availabilityZone: node.availabilityZone,
      tags: (node.tags as Record<string, string>) || {},
      metadata: (node.metadata as Record<string, unknown>) || {},
      lastSeenAt: node.lastSeenAt,
      criticalityScore: node.criticalityScore ?? undefined,
      redundancyScore: node.redundancyScore ?? undefined,
      blastRadius: node.blastRadius ?? undefined,
      isSPOF: node.isSPOF,
      betweennessCentrality: node.betweennessCentrality ?? undefined,
      suggestedRTO: node.suggestedRTO ?? undefined,
      suggestedRPO: node.suggestedRPO ?? undefined,
      suggestedMTPD: node.suggestedMTPD ?? undefined,
      validatedRTO: node.validatedRTO ?? undefined,
      validatedRPO: node.validatedRPO ?? undefined,
      validatedMTPD: node.validatedMTPD ?? undefined,
      impactCategory: node.impactCategory ?? undefined,
      financialImpactPerHour: node.financialImpactPerHour ?? undefined,
    };
    graph.addNode(node.id, attrs);
  }

  for (const edge of edges) {
    if (graph.hasNode(edge.sourceId) && graph.hasNode(edge.targetId)) {
      const edgeKey = `${edge.sourceId}->${edge.targetId}:${edge.type}`;
      if (!graph.hasEdge(edgeKey)) {
        graph.addEdgeWithKey(edgeKey, edge.sourceId, edge.targetId, {
          type: edge.type,
          confidence: edge.confidence,
          inferenceMethod: edge.inferenceMethod,
          confirmed: edge.confirmed,
          metadata: (edge.metadata as Record<string, unknown>) || {},
        });
      }
    }
  }

  graphInstances.set(tenantId, graph);
  return graph;
}

// --- Get graph (loads from DB if not in memory) ---
export async function getGraph(prisma: PrismaClient, tenantId: string): Promise<GraphInstance> {
  const existing = graphInstances.get(tenantId);
  if (existing && existing.order > 0) return existing;
  return loadGraphFromDB(prisma, tenantId);
}

// --- Clone graph for simulations ---
export function cloneGraph(graph: GraphInstance): GraphInstance {
  return graph.copy();
}

// --- Ingest scan results ---
export async function ingestScanResults(
  prisma: PrismaClient,
  tenantId: string,
  results: ScanResult
): Promise<IngestReport> {
  logInfo('graph.ingest.start', { tenantId, provider: results.provider, nodes: results.nodes.length, edges: results.edges.length });

  const report: IngestReport = {
    provider: results.provider,
    scannedAt: results.scannedAt,
    totalNodes: results.nodes.length,
    totalEdges: results.edges.length,
    nodesCreated: 0,
    nodesUpdated: 0,
    nodesRemoved: 0,
    edgesCreated: 0,
    edgesUpdated: 0,
    edgesRemoved: 0,
  };

  const nodeIdMap = new Map<string, string>();

  for (const node of results.nodes) {
    const externalId = node.externalId || node.id;
    const existing = await prisma.infraNode.findFirst({
      where: { tenantId, externalId },
    });

    if (existing) {
      await prisma.infraNode.update({
        where: { id: existing.id },
        data: {
          name: node.name,
          type: node.type,
          provider: node.provider,
          region: node.region ?? null,
          availabilityZone: node.availabilityZone ?? null,
          tags: (node.tags || {}) as any,
          metadata: (node.metadata || {}) as any,
          lastSeenAt: new Date(),
        },
      });
      nodeIdMap.set(node.id, existing.id);
      nodeIdMap.set(externalId, existing.id);
      report.nodesUpdated++;
    } else {
      const created = await prisma.infraNode.create({
        data: {
          externalId,
          name: node.name,
          type: node.type,
          provider: node.provider,
          region: node.region ?? null,
          availabilityZone: node.availabilityZone ?? null,
          tags: (node.tags || {}) as any,
          metadata: (node.metadata || {}) as any,
          lastSeenAt: new Date(),
          tenantId,
        },
      });
      nodeIdMap.set(node.id, created.id);
      nodeIdMap.set(externalId, created.id);
      report.nodesCreated++;
    }
  }

  for (const edge of results.edges) {
    const sourceId = nodeIdMap.get(edge.source);
    const targetId = nodeIdMap.get(edge.target);
    if (!sourceId || !targetId) continue;

    const existing = await prisma.infraEdge.findFirst({
      where: { sourceId, targetId, type: edge.type },
    });

    if (existing) {
      report.edgesUpdated++;
    } else {
      await prisma.infraEdge.create({
        data: {
          sourceId,
          targetId,
          type: edge.type,
          confidence: edge.confidence ?? 1.0,
          inferenceMethod: edge.inferenceMethod ?? null,
          tenantId,
        },
      });
      report.edgesCreated++;
    }
  }

  await loadGraphFromDB(prisma, tenantId);
  logInfo('graph.ingest.completed', { tenantId, provider: results.provider, nodesCreated: report.nodesCreated, nodesUpdated: report.nodesUpdated, edgesCreated: report.edgesCreated, edgesUpdated: report.edgesUpdated });
  return report;
}

// --- Helpers to cast node attributes ---
function nodeAttrs(graph: GraphInstance, nodeId: string): InfraNodeAttrs {
  return graph.getNodeAttributes(nodeId) as unknown as InfraNodeAttrs;
}

// --- Query: Get direct dependencies of a node ---
export function getDependencies(graph: GraphInstance, nodeId: string): InfraNodeAttrs[] {
  if (!graph.hasNode(nodeId)) return [];
  return graph.outNeighbors(nodeId).map((id: string) => nodeAttrs(graph, id));
}

// --- Query: Get direct dependents of a node ---
export function getDependents(graph: GraphInstance, nodeId: string): InfraNodeAttrs[] {
  if (!graph.hasNode(nodeId)) return [];
  return graph.inNeighbors(nodeId).map((id: string) => nodeAttrs(graph, id));
}

// --- Query: Get blast radius (all cascaded dependents) ---
export function getBlastRadius(graph: GraphInstance, nodeId: string): InfraNodeAttrs[] {
  if (!graph.hasNode(nodeId)) return [];
  const visited = new Set<string>([nodeId]);
  const queue = [nodeId];
  const impacted: InfraNodeAttrs[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents: string[] = graph.inNeighbors(current);
    for (const dep of dependents) {
      if (!visited.has(dep)) {
        visited.add(dep);
        impacted.push(nodeAttrs(graph, dep));
        queue.push(dep);
      }
    }
  }

  return impacted;
}

// --- Query: Get region blast radius ---
export function getRegionBlastRadius(graph: GraphInstance, region: string): InfraNodeAttrs[] {
  const nodesInRegion: string[] = [];
  graph.forEachNode((id: string, attrs: any) => {
    if (attrs.region === region) {
      nodesInRegion.push(id);
    }
  });

  const allImpacted = new Set<string>();
  for (const nId of nodesInRegion) {
    allImpacted.add(nId);
    const blast = getBlastRadius(graph, nId);
    for (const n of blast) allImpacted.add(n.id);
  }

  for (const nId of nodesInRegion) allImpacted.delete(nId);

  return Array.from(allImpacted).map(id => nodeAttrs(graph, id));
}

// --- Query: Get subgraph around a node with depth ---
export function getSubgraph(graph: GraphInstance, nodeId: string, maxDepth: number): {
  nodes: InfraNodeAttrs[];
  edges: Array<{ source: string; target: string; type: string }>;
} {
  if (!graph.hasNode(nodeId)) return { nodes: [], edges: [] };

  const visited = new Set<string>([nodeId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
  const resultEdges: Array<{ source: string; target: string; type: string }> = [];

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth >= maxDepth) continue;

    const neighbors = new Set([
      ...graph.outNeighbors(item.id) as string[],
      ...graph.inNeighbors(item.id) as string[],
    ]);

    for (const neighbor of neighbors) {
      graph.forEachEdge(item.id, (edgeKey: string, edgeAttrs: any, source: string, target: string) => {
        if ((source === item.id && target === neighbor) || (source === neighbor && target === item.id)) {
          resultEdges.push({ source, target, type: edgeAttrs.type });
        }
      });

      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, depth: item.depth + 1 });
      }
    }
  }

  const nodes = Array.from(visited).map(id => nodeAttrs(graph, id));

  const edgeSet = new Set<string>();
  const uniqueEdges = resultEdges.filter(e => {
    const key = `${e.source}->${e.target}:${e.type}`;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    return true;
  });

  return { nodes, edges: uniqueEdges };
}

// --- Query: Export for visualization ---
export function exportForVisualization(graph: GraphInstance): {
  nodes: Array<Record<string, unknown>>;
  edges: Array<{ id: string; source: string; target: string; type: string; confidence: number }>;
} {
  const nodes: Array<Record<string, unknown>> = [];
  graph.forEachNode((id: string, attrs: any) => {
    nodes.push({ ...attrs, id });
  });

  const edges: Array<{ id: string; source: string; target: string; type: string; confidence: number }> = [];
  graph.forEachEdge((edgeKey: string, attrs: any, source: string, target: string) => {
    edges.push({
      id: edgeKey,
      source,
      target,
      type: attrs.type,
      confidence: attrs.confidence,
    });
  });

  return { nodes, edges };
}

// --- Calculate cascade for simulation ---
export function calculateCascade(
  graph: GraphInstance,
  affectedNodeIds: string[]
): CascadeNode[] {
  const cascade: CascadeNode[] = [];
  const affectedSet = new Set(affectedNodeIds);
  const downSet = new Set(affectedNodeIds);
  const visited = new Set<string>();

  let currentLayer = [...affectedNodeIds];
  let depth = 0;

  while (currentLayer.length > 0 && depth < 20) {
    depth++;
    const nextLayer: string[] = [];

    for (const nId of currentLayer) {
      if (!graph.hasNode(nId)) continue;
      const dependents: string[] = graph.inNeighbors(nId);
      const filtered = dependents.filter(
        (id: string) => !visited.has(id) && !affectedSet.has(id)
      );

      for (const depId of filtered) {
        if (visited.has(depId)) continue;

        const allDeps: string[] = graph.outNeighbors(depId);
        const healthyDeps = allDeps.filter((d: string) => !affectedSet.has(d) && !downSet.has(d));

        let status: 'down' | 'degraded';
        let reason: string;

        if (healthyDeps.length === 0 && allDeps.length > 0) {
          status = 'down';
          reason = 'All dependencies unavailable';
        } else if (healthyDeps.length < allDeps.length) {
          status = 'degraded';
          reason = `${allDeps.length - healthyDeps.length}/${allDeps.length} dependencies unavailable`;
        } else {
          continue;
        }

        const na = nodeAttrs(graph, depId);
        if (na.metadata?.isMultiAZ && status === 'down') {
          status = 'degraded';
          reason += ' (multi-AZ active, failover in progress)';
        }

        visited.add(depId);
        cascade.push({
          id: depId,
          name: na.name,
          type: na.type,
          status,
          cascadeReason: reason,
          cascadeDepth: depth,
        });

        if (status === 'down') {
          downSet.add(depId);
          nextLayer.push(depId);
        }
      }
    }

    currentLayer = nextLayer;
  }

  return cascade;
}

// --- Clear cached graph ---
export function clearGraph(tenantId: string): void {
  graphInstances.delete(tenantId);
}

// --- Get graph stats ---
export function getGraphStats(graph: GraphInstance): {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  nodesByProvider: Record<string, number>;
  nodesByRegion: Record<string, number>;
} {
  const nodesByType: Record<string, number> = {};
  const nodesByProvider: Record<string, number> = {};
  const nodesByRegion: Record<string, number> = {};

  graph.forEachNode((_id: string, attrs: any) => {
    nodesByType[attrs.type] = (nodesByType[attrs.type] || 0) + 1;
    nodesByProvider[attrs.provider] = (nodesByProvider[attrs.provider] || 0) + 1;
    if (attrs.region) {
      nodesByRegion[attrs.region] = (nodesByRegion[attrs.region] || 0) + 1;
    }
  });

  return { totalNodes: graph.order, totalEdges: graph.size, nodesByType, nodesByProvider, nodesByRegion };
}

// =====================================================
//  CRITICAL PATHS — paths where removing a single node
//  cuts connectivity between important endpoints
// =====================================================

export function getCriticalPaths(graph: GraphInstance): CriticalPath[] {
  const paths: CriticalPath[] = [];

  // Identify "endpoint" nodes — services that face users or external systems
  const endpointTypes = new Set([
    'APPLICATION', 'MICROSERVICE', 'API_GATEWAY', 'LOAD_BALANCER', 'SERVERLESS',
  ]);
  const dataTypes = new Set(['DATABASE', 'CACHE', 'OBJECT_STORAGE', 'MESSAGE_QUEUE']);

  const endpoints: string[] = [];
  const dataSources: string[] = [];

  graph.forEachNode((nodeId: string, attrs: any) => {
    if (endpointTypes.has(attrs.type)) endpoints.push(nodeId);
    if (dataTypes.has(attrs.type)) dataSources.push(nodeId);
  });

  // For each (endpoint → data source) pair, find if there's a single-path dependency
  for (const ep of endpoints.slice(0, 30)) {
    for (const ds of dataSources.slice(0, 30)) {
      if (ep === ds) continue;

      // BFS to find all shortest paths from ep to ds (following outEdges)
      const allPaths = findAllShortestPaths(graph, ep, ds);
      if (allPaths.length === 0) continue;

      // If there is exactly one shortest path, every node on it is a bottleneck
      if (allPaths.length === 1) {
        const pathNodes = allPaths[0]!;
        const bottlenecks = pathNodes.slice(1, -1).map((id: string) => {
          const a = graph.getNodeAttributes(id) as InfraNodeAttrs;
          return { id, name: a.name, reason: 'Single path between endpoint and data source' };
        });

        if (bottlenecks.length > 0) {
          const epAttrs = graph.getNodeAttributes(ep) as InfraNodeAttrs;
          const dsAttrs = graph.getNodeAttributes(ds) as InfraNodeAttrs;
          paths.push({
            from: epAttrs.name,
            to: dsAttrs.name,
            path: pathNodes.map((id: string) => {
              const a = graph.getNodeAttributes(id) as InfraNodeAttrs;
              return { id, name: a.name, type: a.type };
            }),
            bottlenecks,
          });
        }
      }
    }
  }

  return paths;
}

/** BFS to find all shortest paths between two nodes (directed, following outEdges) */
function findAllShortestPaths(graph: GraphInstance, start: string, end: string): string[][] {
  if (!graph.hasNode(start) || !graph.hasNode(end)) return [];

  const queue: string[][] = [[start]];
  const visited = new Map<string, number>(); // node → shortest distance
  visited.set(start, 0);
  const results: string[][] = [];
  let shortestLength = Infinity;

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1]!;

    if (path.length > shortestLength) break;

    if (current === end) {
      shortestLength = path.length;
      results.push(path);
      continue;
    }

    for (const neighbor of graph.outNeighbors(current)) {
      const newDist = path.length;
      const prevDist = visited.get(neighbor);
      if (prevDist === undefined || newDist <= prevDist) {
        visited.set(neighbor, newDist);
        queue.push([...path, neighbor]);
      }
    }
  }

  return results;
}
