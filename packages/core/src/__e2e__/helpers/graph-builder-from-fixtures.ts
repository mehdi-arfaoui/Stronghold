import { MultiDirectedGraph } from 'graphology';

import type { GraphInstance } from '../../graph/graph-instance.js';
import { transformToScanResult } from '../../providers/aws/graph-bridge.js';
import type { Resource } from '../../types/resource.js';

export interface SyntheticFixtureEdge {
  readonly source: string;
  readonly target: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

type GraphRecord = Record<string, unknown>;

export function buildGraphFromFixtures(
  resources: readonly Resource[],
  edges: readonly SyntheticFixtureEdge[],
): GraphInstance {
  const transformed = transformToScanResult([...resources], [], 'aws');
  const graph = new MultiDirectedGraph<GraphRecord, GraphRecord>();

  for (const node of transformed.nodes) {
    if (!graph.hasNode(node.id)) {
      graph.addNode(node.id, { ...node });
    }
  }

  const seenEdges = new Set<string>();

  for (const edge of transformed.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      continue;
    }

    const dedupeKey = `${edge.source}->${edge.target}:${edge.type}`;
    if (seenEdges.has(dedupeKey)) {
      continue;
    }

    seenEdges.add(dedupeKey);
    graph.addEdgeWithKey(dedupeKey, edge.source, edge.target, {
      type: edge.type,
      confidence: edge.confidence ?? 1,
      inferenceMethod: edge.inferenceMethod ?? 'fixture_transform',
      confirmed: true,
      ...(edge.metadata ? { metadata: { ...edge.metadata } } : {}),
      ...(edge.provenance ? { provenance: edge.provenance } : {}),
      ...(edge.reason ? { reason: edge.reason } : {}),
    });
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      continue;
    }

    const type =
      typeof edge.attributes.type === 'string' && edge.attributes.type.length > 0
        ? edge.attributes.type
        : 'DEPENDS_ON';
    const dedupeKey = `${edge.source}->${edge.target}:${type}`;
    if (seenEdges.has(dedupeKey)) {
      continue;
    }

    seenEdges.add(dedupeKey);
    graph.addEdgeWithKey(dedupeKey, edge.source, edge.target, {
      ...edge.attributes,
      type,
      confidence:
        typeof edge.attributes.confidence === 'number'
          ? edge.attributes.confidence
          : 1,
      confirmed:
        typeof edge.attributes.confirmed === 'boolean'
          ? edge.attributes.confirmed
          : true,
    });
  }

  return graph as unknown as GraphInstance;
}
