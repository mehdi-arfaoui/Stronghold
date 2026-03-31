import { DirectedGraph } from 'graphology';

import type { GraphInstance, InfraNode, ScanEdge } from '@stronghold-dr/core';

import type { StoredScanEdge } from '../storage/file-store.js';

type GraphRecord = Record<string, unknown>;
type CliGraph = DirectedGraph<GraphRecord, GraphRecord>;

export function buildGraph(
  nodes: readonly InfraNode[],
  edges: ReadonlyArray<StoredScanEdge | ScanEdge>,
): GraphInstance {
  const graph: CliGraph = new DirectedGraph<GraphRecord, GraphRecord>();

  for (const node of nodes) {
    if (graph.hasNode(node.id)) {
      continue;
    }
    graph.addNode(node.id, node as unknown as GraphRecord);
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      continue;
    }

    const key = buildEdgeKey(edge);
    if (graph.hasEdge(key)) {
      continue;
    }

    graph.addEdgeWithKey(key, edge.source, edge.target, {
      type: edge.type,
      confidence: 'confidence' in edge && typeof edge.confidence === 'number' ? edge.confidence : 1,
      confirmed: true,
      ...('metadata' in edge && edge.metadata ? { metadata: edge.metadata } : {}),
      ...('inferenceMethod' in edge && edge.inferenceMethod
        ? { inferenceMethod: edge.inferenceMethod }
        : {}),
    });
  }

  return graph as unknown as GraphInstance;
}

export function snapshotNodes(graph: GraphInstance): readonly InfraNode[] {
  const nodes: InfraNode[] = [];
  graph.forEachNode((_nodeId, attrs) => {
    nodes.push(attrs as unknown as InfraNode);
  });
  return nodes.sort((left, right) => left.id.localeCompare(right.id));
}

export function snapshotEdges(graph: GraphInstance): ReadonlyArray<StoredScanEdge> {
  const edges: StoredScanEdge[] = [];
  graph.forEachEdge((edgeKey, attrs, source, target) => {
    void edgeKey;
    edges.push({
      source,
      target,
      type: String(attrs.type ?? 'DEPENDS_ON'),
    });
  });
  return edges.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target) ||
      left.type.localeCompare(right.type),
  );
}

function buildEdgeKey(edge: StoredScanEdge | ScanEdge): string {
  return `${edge.source}->${edge.target}:${edge.type}`;
}
