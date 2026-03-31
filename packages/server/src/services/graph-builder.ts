import { DirectedGraph } from 'graphology';

import type { GraphInstance, InfraNode, ScanEdge } from '@stronghold-dr/core';

type GraphRecord = Record<string, unknown>;
type ServerGraph = DirectedGraph<GraphRecord, GraphRecord>;

export function buildGraph(
  nodes: readonly InfraNode[],
  edges: ReadonlyArray<ScanEdge>,
): GraphInstance {
  const graph: ServerGraph = new DirectedGraph<GraphRecord, GraphRecord>();

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

    const edgeKey = `${edge.source}->${edge.target}:${edge.type}`;
    if (graph.hasEdge(edgeKey)) {
      continue;
    }

    graph.addEdgeWithKey(edgeKey, edge.source, edge.target, {
      type: edge.type,
      confidence: typeof edge.confidence === 'number' ? edge.confidence : 1,
      confirmed: true,
      ...(edge.inferenceMethod ? { inferenceMethod: edge.inferenceMethod } : {}),
      ...(edge.metadata ? { metadata: edge.metadata } : {}),
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

export function snapshotEdges(graph: GraphInstance): ReadonlyArray<ScanEdge> {
  const edges: ScanEdge[] = [];
  graph.forEachEdge((_edgeId, attrs, source, target) => {
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
