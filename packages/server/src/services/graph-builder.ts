import { MultiDirectedGraph } from 'graphology';

import type { GraphInstance, InfraNode, ScanEdge } from '@stronghold-dr/core';

type GraphRecord = Record<string, unknown>;
type ServerGraph = MultiDirectedGraph<GraphRecord, GraphRecord>;
const AWS_API_INFERENCE_METHODS = new Set(['metadata', 'network_flow']);

export function buildGraph(
  nodes: readonly InfraNode[],
  edges: ReadonlyArray<ScanEdge>,
): GraphInstance {
  const graph: ServerGraph = new MultiDirectedGraph<GraphRecord, GraphRecord>();

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
      provenance: resolveEdgeProvenance(edge),
      ...(edge.reason ? { reason: edge.reason } : {}),
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
      ...(typeof attrs.confidence === 'number' ? { confidence: attrs.confidence } : {}),
      ...(typeof attrs.inferenceMethod === 'string' ? { inferenceMethod: attrs.inferenceMethod } : {}),
      ...(attrs.metadata && typeof attrs.metadata === 'object' ? { metadata: attrs.metadata as Record<string, unknown> } : {}),
      ...(typeof attrs.provenance === 'string' ? { provenance: attrs.provenance as ScanEdge['provenance'] } : {}),
      ...(typeof attrs.reason === 'string' ? { reason: attrs.reason } : {}),
    });
  });
  return edges.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target) ||
      left.type.localeCompare(right.type),
  );
}

function resolveEdgeProvenance(edge: ScanEdge): ScanEdge['provenance'] {
  if (edge.provenance) {
    return edge.provenance;
  }
  if (edge.reason) {
    return 'manual';
  }
  if (edge.inferenceMethod && !AWS_API_INFERENCE_METHODS.has(edge.inferenceMethod)) {
    return 'inferred';
  }
  return 'aws-api';
}
