import type { InfraEdge } from '@/types/graph.types';

export function buildVisibleFlowNodeIds(flowNodeIds: string[], edges: InfraEdge[]): Set<string> {
  const flowNodeIdSet = new Set(flowNodeIds);
  const visibleNodeIds = new Set(flowNodeIds);

  for (const edge of edges) {
    if (flowNodeIdSet.has(edge.source)) visibleNodeIds.add(edge.target);
    if (flowNodeIdSet.has(edge.target)) visibleNodeIds.add(edge.source);
  }

  return visibleNodeIds;
}
