import type { GraphInstance } from '../graph/index.js';
import type { InfraNodeAttrs } from '../types/index.js';
import type { DriftReport } from './drift-types.js';

export interface AnalyzeDriftImpactOptions {
  readonly criticalityThreshold?: number;
  readonly criticalNodeIds?: readonly string[];
  readonly drpComponentIds?: readonly string[];
}

const STALE_SEVERITIES = new Set(['critical', 'high']);

/**
 * Enriches drift changes with impacted critical services and whether the DRP should be regenerated.
 */
export function analyzeDriftImpact(
  report: DriftReport,
  graph: GraphInstance,
  options: AnalyzeDriftImpactOptions = {},
): DriftReport {
  const threshold = options.criticalityThreshold ?? 70;
  const criticalNodeIds = new Set(
    options.criticalNodeIds ?? collectCriticalNodeIds(graph, threshold),
  );
  const drpComponentIds = new Set(options.drpComponentIds ?? []);
  let drpStale = report.summary.drpStale;

  const changes = report.changes.map((change) => {
    const impactedIds = collectImpactedCriticalNodeIds(change.resourceId, graph, criticalNodeIds);
    if (!drpStale && STALE_SEVERITIES.has(change.severity)) {
      drpStale =
        drpComponentIds.size > 0
          ? touchesDrpComponents(change.resourceId, impactedIds, drpComponentIds)
          : impactedIds.length > 0;
    }

    return {
      ...change,
      affectedServices: impactedIds.map((nodeId) => getNodeName(graph, nodeId)),
    };
  });

  return {
    ...report,
    changes,
    summary: {
      ...report.summary,
      drpStale,
    },
  };
}

function collectCriticalNodeIds(
  graph: GraphInstance,
  threshold: number,
): readonly string[] {
  const ids: string[] = [];
  graph.forEachNode((nodeId, rawAttrs) => {
    const attrs = rawAttrs as unknown as InfraNodeAttrs;
    if (isCriticalNode(attrs, threshold)) ids.push(nodeId);
  });
  return ids.sort();
}

function isCriticalNode(node: InfraNodeAttrs, threshold: number): boolean {
  if (typeof node.criticalityScore === 'number' && node.criticalityScore >= threshold) return true;
  const impact = String(node.impactCategory ?? '').toLowerCase();
  return impact === 'critical' || impact === 'high';
}

function collectImpactedCriticalNodeIds(
  resourceId: string,
  graph: GraphInstance,
  criticalNodeIds: ReadonlySet<string>,
): readonly string[] {
  if (!graph.hasNode(resourceId)) {
    return criticalNodeIds.has(resourceId) ? [resourceId] : [];
  }

  const impacted = new Set<string>();
  const visited = new Set<string>([resourceId]);
  const queue = [resourceId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (criticalNodeIds.has(current)) impacted.add(current);

    for (const dependentId of graph.inNeighbors(current)) {
      if (visited.has(dependentId)) continue;
      visited.add(dependentId);
      queue.push(dependentId);
    }
  }

  return Array.from(impacted).sort((left, right) => getNodeName(graph, left).localeCompare(getNodeName(graph, right)));
}

function touchesDrpComponents(
  resourceId: string,
  impactedNodeIds: readonly string[],
  drpComponentIds: ReadonlySet<string>,
): boolean {
  if (drpComponentIds.has(resourceId)) return true;
  return impactedNodeIds.some((nodeId) => drpComponentIds.has(nodeId));
}

function getNodeName(graph: GraphInstance, nodeId: string): string {
  if (!graph.hasNode(nodeId)) return nodeId;
  const attrs = graph.getNodeAttributes(nodeId) as unknown as InfraNodeAttrs;
  return attrs.name;
}
