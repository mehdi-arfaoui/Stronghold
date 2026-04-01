import {
  applyGraphOverrides,
  inferDependencies,
  type GraphOverrides,
  type InfraNode,
  type ScanEdge,
} from '@stronghold-dr/core';

import type { StoredScanEdge } from '../storage/file-store.js';

const AWS_API_INFERENCE_METHODS = new Set(['metadata', 'network_flow']);

export interface PreparePipelineGraphInput {
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<StoredScanEdge | ScanEdge>;
  readonly graphOverrides?: GraphOverrides | null;
}

export interface PreparePipelineGraphResult {
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<StoredScanEdge>;
  readonly warnings: readonly string[];
}

export function preparePipelineGraph(input: PreparePipelineGraphInput): PreparePipelineGraphResult {
  const normalizedEdges = deduplicateEdges(input.edges.map((edge) => normalizeEdge(edge)));
  const inferredEdges = inferDependencies(
    input.nodes as InfraNode[],
    normalizedEdges as ScanEdge[],
  ).map((edge) => normalizeEdge(edge, 'inferred'));
  const combinedEdges = deduplicateEdges([...normalizedEdges, ...inferredEdges]);

  if (!input.graphOverrides) {
    return {
      nodes: [...input.nodes],
      edges: combinedEdges,
      warnings: [],
    };
  }

  const applied = applyGraphOverrides(input.nodes, combinedEdges, input.graphOverrides);

  return {
    nodes: applied.nodes as readonly InfraNode[],
    edges: deduplicateEdges(applied.edges.map((edge) => normalizeEdge(edge))),
    warnings: applied.warnings.map((warning) => warning.message),
  };
}

export function normalizeEdge(
  edge: StoredScanEdge | ScanEdge,
  fallbackProvenance?: StoredScanEdge['provenance'],
): StoredScanEdge {
  const inferredFallback =
    edge.provenance ??
    (edge.reason
      ? 'manual'
      : edge.inferenceMethod && !AWS_API_INFERENCE_METHODS.has(edge.inferenceMethod)
        ? 'inferred'
        : fallbackProvenance ?? 'aws-api');

  return {
    source: edge.source,
    target: edge.target,
    type: edge.type,
    ...(typeof edge.confidence === 'number' ? { confidence: edge.confidence } : {}),
    ...(edge.inferenceMethod ? { inferenceMethod: edge.inferenceMethod } : {}),
    ...(edge.metadata ? { metadata: edge.metadata } : {}),
    provenance: inferredFallback,
    ...(edge.reason ? { reason: edge.reason } : {}),
  };
}

function deduplicateEdges(edges: readonly StoredScanEdge[]): ReadonlyArray<StoredScanEdge> {
  const deduped = new Map<string, StoredScanEdge>();

  for (const edge of edges) {
    deduped.set(buildEdgeKey(edge), edge);
  }

  return Array.from(deduped.values()).sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target) ||
      left.type.localeCompare(right.type),
  );
}

function buildEdgeKey(edge: Pick<StoredScanEdge, 'source' | 'target' | 'type'>): string {
  return `${edge.source}->${edge.target}:${edge.type}`;
}
