import type { InfraNodeAttrs, ScanEdge } from '../../types/index.js';

import type {
  ApplyGraphOverridesResult,
  ApplyGraphOverridesWarning,
  GraphCriticalityOverride,
  GraphEdgeOverride,
  GraphOverrides,
} from './types.js';

export function applyGraphOverrides(
  nodes: readonly InfraNodeAttrs[],
  edges: readonly ScanEdge[],
  overrides: GraphOverrides,
): ApplyGraphOverridesResult {
  const nodeMap = new Map(nodes.map((node) => [node.id, { ...node }] as const));
  const edgeMap = new Map(edges.map((edge) => [buildEdgeKey(edge), normalizeEdge(edge)] as const));
  const warnings: ApplyGraphOverridesWarning[] = [];

  for (const override of overrides.add_edges) {
    applyEdgeAddition(nodeMap, edgeMap, override, warnings);
  }

  for (const override of overrides.remove_edges) {
    applyEdgeRemoval(edgeMap, override, warnings);
  }

  for (const override of overrides.criticality_overrides) {
    applyCriticalityOverride(nodeMap, override, warnings);
  }

  return {
    nodes: Array.from(nodeMap.values()).sort((left, right) => left.id.localeCompare(right.id)),
    edges: Array.from(edgeMap.values()).sort(compareEdges),
    warnings,
  };
}

export function buildEdgeKey(edge: Pick<ScanEdge, 'source' | 'target' | 'type'>): string {
  return `${edge.source}->${edge.target}:${edge.type}`;
}

function applyEdgeAddition(
  nodeMap: Map<string, InfraNodeAttrs>,
  edgeMap: Map<string, ScanEdge>,
  override: GraphEdgeOverride,
  warnings: ApplyGraphOverridesWarning[],
): void {
  const missingNodes = [override.source, override.target].filter((nodeId) => !nodeMap.has(nodeId));
  if (missingNodes.length > 0) {
    warnings.push({
      code: 'missing_node',
      message: `Skipping add_edges entry for ${override.source} -> ${override.target}: missing node(s) ${missingNodes.join(', ')}.`,
    });
    return;
  }

  const key = buildEdgeKey(override);
  const existing = edgeMap.get(key);
  if (existing?.provenance === 'manual') {
    warnings.push({
      code: 'duplicate_edge',
      message: `Duplicate manual override for edge ${override.source} -> ${override.target} (${override.type}). Keeping the latest reason.`,
    });
  }

  edgeMap.set(key, {
    ...(existing ?? {}),
    source: override.source,
    target: override.target,
    type: override.type,
    confidence: 1,
    provenance: 'manual',
    reason: override.reason,
    metadata: {
      ...(existing?.metadata ?? {}),
      overrideReason: override.reason,
    },
  });
}

function applyEdgeRemoval(
  edgeMap: Map<string, ScanEdge>,
  override: GraphEdgeOverride,
  warnings: ApplyGraphOverridesWarning[],
): void {
  const key = buildEdgeKey(override);
  if (!edgeMap.has(key)) {
    warnings.push({
      code: 'missing_edge',
      message: `Skipping remove_edges entry for ${override.source} -> ${override.target} (${override.type}): edge not found.`,
    });
    return;
  }

  edgeMap.delete(key);
}

function applyCriticalityOverride(
  nodeMap: Map<string, InfraNodeAttrs>,
  override: GraphCriticalityOverride,
  warnings: ApplyGraphOverridesWarning[],
): void {
  const existing = nodeMap.get(override.node);
  if (!existing) {
    warnings.push({
      code: 'missing_criticality_target',
      message: `Skipping criticality_overrides entry for ${override.node}: node not found.`,
    });
    return;
  }

  nodeMap.set(override.node, {
    ...existing,
    criticalityScore: override.score,
    criticalitySource: 'manual',
    criticalityOverrideReason: override.reason,
  });
}

function normalizeEdge(edge: ScanEdge): ScanEdge {
  return {
    ...edge,
    ...(edge.provenance ? {} : { provenance: 'aws-api' as const }),
  };
}

function compareEdges(left: ScanEdge, right: ScanEdge): number {
  return (
    left.source.localeCompare(right.source) ||
    left.target.localeCompare(right.target) ||
    left.type.localeCompare(right.type)
  );
}
