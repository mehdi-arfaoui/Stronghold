import { MultiDirectedGraph } from 'graphology';

import type { GraphInstance, InfraNode, ScanEdge } from '@stronghold-dr/core';

import type { StoredScanEdge } from '../storage/file-store.js';

const AWS_API_INFERENCE_METHODS = new Set(['metadata', 'network_flow']);

type GraphRecord = Record<string, unknown>;
type CliGraph = MultiDirectedGraph<GraphRecord, GraphRecord>;

export function buildGraph(
  nodes: readonly InfraNode[],
  edges: ReadonlyArray<StoredScanEdge | ScanEdge>,
): GraphInstance {
  const graph: CliGraph = new MultiDirectedGraph<GraphRecord, GraphRecord>();

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
      provenance: resolveEdgeProvenance(edge),
      ...('reason' in edge && edge.reason ? { reason: edge.reason } : {}),
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
      ...(typeof attrs.confidence === 'number' ? { confidence: attrs.confidence } : {}),
      ...(typeof attrs.inferenceMethod === 'string' ? { inferenceMethod: attrs.inferenceMethod } : {}),
      ...(attrs.metadata && typeof attrs.metadata === 'object' ? { metadata: attrs.metadata as Record<string, unknown> } : {}),
      ...(typeof attrs.provenance === 'string' ? { provenance: attrs.provenance as StoredScanEdge['provenance'] } : {}),
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

function buildEdgeKey(edge: StoredScanEdge | ScanEdge): string {
  return `${edge.source}->${edge.target}:${edge.type}`;
}

function resolveEdgeProvenance(edge: StoredScanEdge | ScanEdge): StoredScanEdge['provenance'] {
  if ('provenance' in edge && edge.provenance) {
    return edge.provenance;
  }
  if ('reason' in edge && edge.reason) {
    return 'manual';
  }
  if (
    'inferenceMethod' in edge &&
    typeof edge.inferenceMethod === 'string' &&
    !AWS_API_INFERENCE_METHODS.has(edge.inferenceMethod)
  ) {
    return 'inferred';
  }
  return 'aws-api';
}
