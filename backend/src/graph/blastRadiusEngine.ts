import type { InfraNodeAttrs } from './types.js';
import { EdgeType } from './types.js';
import { isAnalyzableServiceNode } from './serviceClassification.js';

export interface BlastRadiusResult {
  nodeId: string;
  nodeName: string;
  directDependents: number;
  transitiveDependents: number;
  totalServices: number;
  impactRatio: number;
  impactedServices: string[];
  rationale: string;
}

export type BlastEdge = {
  sourceId: string;
  targetId: string;
  type: string;
};

const APPLICATIVE_EDGE_TYPES = new Set<string>([
  EdgeType.NETWORK_ACCESS,
  EdgeType.TRIGGERS,
  EdgeType.USES,
  EdgeType.DEAD_LETTER,
  EdgeType.PUBLISHES_TO,
  EdgeType.PUBLISHES_TO_APPLICATIVE,
  EdgeType.CONNECTS_TO,
  EdgeType.DEPENDS_ON,
  EdgeType.ROUTES_TO,
  EdgeType.SUBSCRIBES_TO,
]);

const INFRA_EDGE_TYPES = new Set<string>([
  EdgeType.PLACED_IN,
  EdgeType.SECURED_BY,
  EdgeType.IAM_ACCESS,
  EdgeType.RUNS_ON,
  EdgeType.CONTAINS,
]);

function isApplicativeEdgeType(edgeType: string): boolean {
  if (INFRA_EDGE_TYPES.has(edgeType)) return false;
  return APPLICATIVE_EDGE_TYPES.has(edgeType);
}

type NormalizedDependency = {
  dependent: string;
  dependency: string;
};

/**
 * Normalize edge semantics as "dependent depends on dependency".
 * If dependency fails, dependent is impacted.
 */
function normalizeEdgeDirection(edge: BlastEdge): NormalizedDependency {
  switch (edge.type) {
    case EdgeType.TRIGGERS:
    case EdgeType.PUBLISHES_TO_APPLICATIVE:
      return {
        dependent: edge.targetId,
        dependency: edge.sourceId,
      };
    case EdgeType.DEAD_LETTER:
      // A DLQ is an auxiliary sink for a queue; treat it as dependent on the source queue.
      return {
        dependent: edge.targetId,
        dependency: edge.sourceId,
      };
    case EdgeType.PUBLISHES_TO:
    case EdgeType.NETWORK_ACCESS:
    case EdgeType.USES:
    case EdgeType.CONNECTS_TO:
    case EdgeType.DEPENDS_ON:
    case EdgeType.ROUTES_TO:
    case EdgeType.SUBSCRIBES_TO:
    default:
      return {
        dependent: edge.sourceId,
        dependency: edge.targetId,
      };
  }
}

function buildImpactMap(edges: BlastEdge[], serviceNodeIds: Set<string>): Map<string, Set<string>> {
  const impactMap = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (!isApplicativeEdgeType(edge.type)) continue;

    const { dependent, dependency } = normalizeEdgeDirection(edge);
    if (!serviceNodeIds.has(dependent) || !serviceNodeIds.has(dependency)) continue;

    if (!impactMap.has(dependency)) {
      impactMap.set(dependency, new Set<string>());
    }
    impactMap.get(dependency)!.add(dependent);
  }

  return impactMap;
}

export function calculateBlastRadius(nodes: InfraNodeAttrs[], edges: BlastEdge[]): BlastRadiusResult[] {
  const serviceNodes = nodes.filter(isAnalyzableServiceNode);
  const serviceNodeIds = new Set(serviceNodes.map((node) => node.id));
  const impactMap = buildImpactMap(edges, serviceNodeIds);

  const totalServices = serviceNodes.length;

  return serviceNodes.map((node) => {
    const impacted = new Set<string>();
    const visited = new Set<string>([node.id]);
    const queue: string[] = [];

    const directDependentsSet = impactMap.get(node.id);
    if (directDependentsSet) {
      for (const dependentId of directDependentsSet) {
        if (visited.has(dependentId)) continue;
        visited.add(dependentId);
        impacted.add(dependentId);
        queue.push(dependentId);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = impactMap.get(current);
      if (!dependents) continue;

      for (const dependentId of dependents) {
        if (visited.has(dependentId)) continue;
        visited.add(dependentId);
        impacted.add(dependentId);
        queue.push(dependentId);
      }
    }

    const directDependents = directDependentsSet
      ? Array.from(directDependentsSet).filter((dependentId) => dependentId !== node.id).length
      : 0;
    const ratioBase = Math.max(1, totalServices - 1);
    const impactRatio = totalServices > 1 ? Math.min(1, impacted.size / ratioBase) : 0;
    const impactedServices = Array.from(impacted).sort();
    const rationale =
      impactedServices.length > 0
        ? `Si ${node.name} tombe, ${impactedServices.length} service(s) sur ${Math.max(0, totalServices - 1)} sont impactes en cascade`
        : `${node.name} n'a aucun service dependant detecte - impact isole`;

    return {
      nodeId: node.id,
      nodeName: node.name,
      directDependents,
      transitiveDependents: impactedServices.length,
      totalServices,
      impactRatio,
      impactedServices,
      rationale,
    };
  });
}
