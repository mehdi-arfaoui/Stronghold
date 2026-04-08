import type { GraphInstance } from '../graph/graph-instance.js';
import type { InfraNodeAttrs } from '../types/infrastructure.js';
import type { Service } from '../services/service-types.js';
import { classifyResourceRole, normalizeEdgeType } from '../services/service-utils.js';
import type { AffectedNode, ScenarioImpact, ServiceScenarioImpact } from './scenario-types.js';

const APPLICATION_EDGE_TYPES = new Set([
  'depends_on',
  'triggers',
  'publishes_to',
  'subscribes_to',
  'connects_to',
  'routes_to',
]);

const CRITICAL_ROLES = new Set(['compute', 'datastore']);
const MAX_CASCADE_DEPTH = 10;

interface ImpactPath {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly serviceId?: string;
  readonly reason: string;
  readonly impactType: 'direct' | 'cascade';
  readonly cascadeDepth: number;
}

interface DependentLink {
  readonly dependentId: string;
  readonly dependencyId: string;
  readonly edgeType: string;
}

export function propagateImpact(
  graph: GraphInstance,
  disruptedNodeIds: readonly string[],
  services: readonly Service[],
): ScenarioImpact {
  if (graph.order === 0 || disruptedNodeIds.length === 0) {
    return buildEmptyImpact(services);
  }

  const nodeById = collectNodes(graph);
  const serviceByNodeId = new Map(
    services.flatMap((service) =>
      service.resources.map((resource) => [resource.nodeId, service.id] as const),
    ),
  );
  const dependentMap = buildDependentMap(graph);
  const affected = new Map<string, ImpactPath>();
  const queue: Array<{ readonly nodeId: string; readonly depth: number }> = [];

  for (const nodeId of disruptedNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }

    affected.set(nodeId, {
      nodeId,
      nodeName: node.name,
      ...(serviceByNodeId.get(nodeId) ? { serviceId: serviceByNodeId.get(nodeId) } : {}),
      reason: 'Directly disrupted by the scenario selection criteria.',
      impactType: 'direct',
      cascadeDepth: 0,
    });
    queue.push({ nodeId, depth: 0 });
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= MAX_CASCADE_DEPTH) {
      continue;
    }

    const dependents = dependentMap.get(current.nodeId) ?? [];
    for (const dependent of dependents) {
      if (affected.has(dependent.dependentId)) {
        continue;
      }

      const node = nodeById.get(dependent.dependentId);
      if (!node) {
        continue;
      }

      affected.set(dependent.dependentId, {
        nodeId: dependent.dependentId,
        nodeName: node.name,
        ...(serviceByNodeId.get(dependent.dependentId)
          ? { serviceId: serviceByNodeId.get(dependent.dependentId) }
          : {}),
        reason: `Depends on ${nodeById.get(dependent.dependencyId)?.name ?? dependent.dependencyId} via ${dependent.edgeType}.`,
        impactType: 'cascade',
        cascadeDepth: current.depth + 1,
      });
      queue.push({ nodeId: dependent.dependentId, depth: current.depth + 1 });
    }
  }

  const directlyAffected = Array.from(affected.values())
    .filter((entry): entry is ImpactPath & { impactType: 'direct' } => entry.impactType === 'direct')
    .sort(compareAffectedNodes);
  const cascadeAffected = Array.from(affected.values())
    .filter(
      (entry): entry is ImpactPath & { impactType: 'cascade' } => entry.impactType === 'cascade',
    )
    .sort(compareAffectedNodes);

  const serviceImpact = services
    .map((service) => buildServiceImpact(service, affected, nodeById))
    .sort((left, right) => left.serviceName.localeCompare(right.serviceName));

  return {
    directlyAffected,
    cascadeAffected,
    totalAffectedNodes: affected.size,
    totalAffectedServices: serviceImpact
      .filter((service) => service.status !== 'unaffected')
      .map((service) => service.serviceId),
    serviceImpact,
  };
}

export function isApplicationDependencyEdge(edgeType: string): boolean {
  return APPLICATION_EDGE_TYPES.has(normalizeEdgeType(edgeType));
}

function buildDependentMap(graph: GraphInstance): Map<string, DependentLink[]> {
  const dependents = new Map<string, DependentLink[]>();

  graph.forEachEdge((edgeKey, attrs, source, target) => {
    void edgeKey;
    const normalizedType = normalizeEdgeType(String(attrs.type ?? ''));
    if (!isApplicationDependencyEdge(normalizedType)) {
      return;
    }

    const dependency =
      normalizedType === 'triggers'
        ? { dependencyId: source, dependentId: target }
        : { dependencyId: target, dependentId: source };

    const current = dependents.get(dependency.dependencyId) ?? [];
    current.push({
      ...dependency,
      edgeType: normalizedType,
    });
    dependents.set(dependency.dependencyId, current);
  });

  return dependents;
}

function collectNodes(graph: GraphInstance): Map<string, InfraNodeAttrs> {
  const nodes = new Map<string, InfraNodeAttrs>();
  graph.forEachNode((nodeId, attrs) => {
    nodes.set(nodeId, attrs as unknown as InfraNodeAttrs);
  });
  return nodes;
}

function buildServiceImpact(
  service: Service,
  affected: ReadonlyMap<string, ImpactPath>,
  nodeById: ReadonlyMap<string, InfraNodeAttrs>,
): ServiceScenarioImpact {
  const resources = service.resources;
  const impactedResources = resources
    .map((resource) => {
      const path = affected.get(resource.nodeId);
      if (!path) {
        return null;
      }

      const node = nodeById.get(resource.nodeId);
      const role = resource.role ?? (node ? classifyResourceRole(node) : 'other');
      return {
        nodeId: resource.nodeId,
        role,
        nodeName: node?.name ?? resource.nodeId,
      };
    })
    .filter(
      (
        resource,
      ): resource is {
        readonly nodeId: string;
        readonly role: ReturnType<typeof classifyResourceRole>;
        readonly nodeName: string;
      } => resource !== null,
    );

  const affectedResources = impactedResources.length;
  const totalResources = resources.length;
  const criticalResourcesAffected = impactedResources
    .filter((resource) => CRITICAL_ROLES.has(resource.role))
    .map((resource) => resource.nodeName)
    .sort();
  const percentageAffected =
    totalResources === 0 ? 0 : Math.round((affectedResources / totalResources) * 100);

  let status: ServiceScenarioImpact['status'] = 'unaffected';
  if (affectedResources > 0) {
    status =
      criticalResourcesAffected.length > 0 || affectedResources === totalResources
        ? 'down'
        : 'degraded';
  }

  return {
    serviceId: service.id,
    serviceName: service.name,
    affectedResources,
    totalResources,
    percentageAffected,
    criticalResourcesAffected,
    status,
  };
}

function buildEmptyImpact(services: readonly Service[]): ScenarioImpact {
  return {
    directlyAffected: [],
    cascadeAffected: [],
    totalAffectedNodes: 0,
    totalAffectedServices: [],
    serviceImpact: services.map((service) => ({
      serviceId: service.id,
      serviceName: service.name,
      affectedResources: 0,
      totalResources: service.resources.length,
      percentageAffected: 0,
      criticalResourcesAffected: [],
      status: 'unaffected',
    })),
  };
}

function compareAffectedNodes(left: AffectedNode, right: AffectedNode): number {
  return (
    left.cascadeDepth - right.cascadeDepth ||
    left.nodeName.localeCompare(right.nodeName) ||
    left.nodeId.localeCompare(right.nodeId)
  );
}
