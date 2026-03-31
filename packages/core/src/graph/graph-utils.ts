/**
 * Pure graph utility functions extracted from the backend graphService.
 * These have zero framework dependencies and operate on GraphInstance.
 */

import type { InfraNodeAttrs, CascadeNode, CriticalPath } from '../types/index.js';
import type { GraphInstance } from './graph-instance.js';

function nodeAttrs(graph: GraphInstance, nodeId: string): InfraNodeAttrs {
  return graph.getNodeAttributes(nodeId) as unknown as InfraNodeAttrs;
}

export function cloneGraph(graph: GraphInstance): GraphInstance {
  return graph.copy();
}

export function getDependencies(graph: GraphInstance, nodeId: string): InfraNodeAttrs[] {
  if (!graph.hasNode(nodeId)) return [];
  return graph.outNeighbors(nodeId).map((id) => nodeAttrs(graph, id));
}

export function getDependents(graph: GraphInstance, nodeId: string): InfraNodeAttrs[] {
  if (!graph.hasNode(nodeId)) return [];
  return graph.inNeighbors(nodeId).map((id) => nodeAttrs(graph, id));
}

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

export function getSubgraph(
  graph: GraphInstance,
  nodeId: string,
  maxDepth: number,
): {
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
      ...(graph.outNeighbors(item.id) as string[]),
      ...(graph.inNeighbors(item.id) as string[]),
    ]);

    for (const neighbor of neighbors) {
      graph.forEachEdge(
        item.id,
        (_edgeKey: string, edgeAttrs: Record<string, unknown>, source: string, target: string) => {
          if (
            (source === item.id && target === neighbor) ||
            (source === neighbor && target === item.id)
          ) {
            resultEdges.push({
              source,
              target,
              type: edgeAttrs.type as string,
            });
          }
        },
      );

      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, depth: item.depth + 1 });
      }
    }
  }

  const nodes = Array.from(visited).map((id) => nodeAttrs(graph, id));

  const edgeSet = new Set<string>();
  const uniqueEdges = resultEdges.filter((e) => {
    const key = `${e.source}->${e.target}:${e.type}`;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    return true;
  });

  return { nodes, edges: uniqueEdges };
}

export function exportForVisualization(graph: GraphInstance): {
  nodes: Array<Record<string, unknown>>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    confidence: number;
  }>;
} {
  const nodes: Array<Record<string, unknown>> = [];
  graph.forEachNode((id, attrs) => {
    nodes.push({ ...attrs, id });
  });

  const edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    confidence: number;
  }> = [];
  graph.forEachEdge(
    (edgeKey: string, attrs: Record<string, unknown>, source: string, target: string) => {
      edges.push({
        id: edgeKey,
        source,
        target,
        type: attrs.type as string,
        confidence: attrs.confidence as number,
      });
    },
  );

  return { nodes, edges };
}

const MAX_CASCADE_DEPTH = 20;

export function calculateCascade(graph: GraphInstance, affectedNodeIds: string[]): CascadeNode[] {
  const cascade: CascadeNode[] = [];
  const affectedSet = new Set(affectedNodeIds);
  const downSet = new Set(affectedNodeIds);
  const visited = new Set<string>();

  const inNeighborsByNode = new Map<string, string[]>();
  const outNeighborsByNode = new Map<string, string[]>();
  const unavailableDependenciesByNode = new Map<string, number>();

  graph.forEachNode((nodeId) => {
    const inNeighbors = graph.inNeighbors(nodeId);
    const outNeighbors = graph.outNeighbors(nodeId);
    inNeighborsByNode.set(nodeId, inNeighbors);
    outNeighborsByNode.set(nodeId, outNeighbors);

    let unavailable = 0;
    for (const depId of outNeighbors) {
      if (downSet.has(depId)) unavailable += 1;
    }
    unavailableDependenciesByNode.set(nodeId, unavailable);
  });

  const queue: Array<{
    nodeId: string;
    depth: number;
    incrementDependents: boolean;
  }> = affectedNodeIds
    .filter((nodeId) => graph.hasNode(nodeId))
    .map((nodeId) => ({ nodeId, depth: 0, incrementDependents: false }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current.depth >= MAX_CASCADE_DEPTH) continue;

    const dependents = inNeighborsByNode.get(current.nodeId) ?? [];
    for (const depId of dependents) {
      if (visited.has(depId) || affectedSet.has(depId)) continue;

      if (current.incrementDependents) {
        unavailableDependenciesByNode.set(
          depId,
          (unavailableDependenciesByNode.get(depId) ?? 0) + 1,
        );
      }

      const allDeps = outNeighborsByNode.get(depId) ?? [];
      const unavailable = unavailableDependenciesByNode.get(depId) ?? 0;
      if (allDeps.length === 0 || unavailable <= 0) continue;

      let status: 'down' | 'degraded' = unavailable >= allDeps.length ? 'down' : 'degraded';
      let reason =
        status === 'down'
          ? 'All dependencies unavailable'
          : `${unavailable}/${allDeps.length} dependencies unavailable`;

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
        cascadeDepth: current.depth + 1,
      });

      if (status === 'down') {
        downSet.add(depId);
        queue.push({
          nodeId: depId,
          depth: current.depth + 1,
          incrementDependents: true,
        });
      }
    }
  }

  return cascade;
}

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

  graph.forEachNode((_id, attrs) => {
    const type = attrs.type as string;
    const provider = attrs.provider as string;
    const region = attrs.region as string | undefined;
    nodesByType[type] = (nodesByType[type] ?? 0) + 1;
    nodesByProvider[provider] = (nodesByProvider[provider] ?? 0) + 1;
    if (region) {
      nodesByRegion[region] = (nodesByRegion[region] ?? 0) + 1;
    }
  });

  return {
    totalNodes: graph.order,
    totalEdges: graph.size,
    nodesByType,
    nodesByProvider,
    nodesByRegion,
  };
}

function findAllShortestPaths(graph: GraphInstance, start: string, end: string): string[][] {
  if (!graph.hasNode(start) || !graph.hasNode(end)) return [];

  const queue: string[][] = [[start]];
  const visited = new Map<string, number>();
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

const ENDPOINT_TYPES = new Set([
  'APPLICATION',
  'MICROSERVICE',
  'API_GATEWAY',
  'LOAD_BALANCER',
  'SERVERLESS',
]);

const DATA_TYPES = new Set(['DATABASE', 'CACHE', 'OBJECT_STORAGE', 'MESSAGE_QUEUE']);

const MAX_CRITICAL_PATH_SAMPLES = 30;

export function getCriticalPaths(graph: GraphInstance): CriticalPath[] {
  const paths: CriticalPath[] = [];

  const endpoints: string[] = [];
  const dataSources: string[] = [];

  graph.forEachNode((nodeId, attrs) => {
    const type = attrs.type as string;
    if (ENDPOINT_TYPES.has(type)) endpoints.push(nodeId);
    if (DATA_TYPES.has(type)) dataSources.push(nodeId);
  });

  for (const ep of endpoints.slice(0, MAX_CRITICAL_PATH_SAMPLES)) {
    for (const ds of dataSources.slice(0, MAX_CRITICAL_PATH_SAMPLES)) {
      if (ep === ds) continue;

      const allPaths = findAllShortestPaths(graph, ep, ds);
      if (allPaths.length !== 1) continue;

      const pathNodes = allPaths[0]!;
      const bottlenecks = pathNodes.slice(1, -1).map((id) => {
        const a = graph.getNodeAttributes(id) as unknown as InfraNodeAttrs;
        return {
          id,
          name: a.name,
          reason: 'Single path between endpoint and data source',
        };
      });

      if (bottlenecks.length > 0) {
        const epAttrs = graph.getNodeAttributes(ep) as unknown as InfraNodeAttrs;
        const dsAttrs = graph.getNodeAttributes(ds) as unknown as InfraNodeAttrs;
        paths.push({
          from: epAttrs.name,
          to: dsAttrs.name,
          path: pathNodes.map((id) => {
            const a = graph.getNodeAttributes(id) as unknown as InfraNodeAttrs;
            return { id, name: a.name, type: a.type };
          }),
          bottlenecks,
        });
      }
    }
  }

  return paths;
}
