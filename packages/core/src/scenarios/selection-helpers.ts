import type { InfraNodeAttrs } from '../types/infrastructure.js';
import { getMetadata, readString } from '../graph/analysis-helpers.js';
import type { Service } from '../services/service-types.js';
import { classifyResourceRole, normalizeEdgeType, resolveTagValue } from '../services/service-utils.js';
import { collectNodeKinds, normalizeType } from '../validation/validation-node-utils.js';

export function selectByAZ(nodes: readonly InfraNodeAttrs[], az: string): readonly string[] {
  return nodes
    .filter((node) => getAvailability(node) === az)
    .map((node) => node.id)
    .sort();
}

export function selectByRegion(
  nodes: readonly InfraNodeAttrs[],
  region: string,
): readonly string[] {
  return nodes
    .filter((node) => resolveRegion(node) === region)
    .map((node) => node.id)
    .sort();
}

export function selectByServiceType(
  nodes: readonly InfraNodeAttrs[],
  serviceType: string,
): readonly string[] {
  const normalizedServiceType = normalizeType(serviceType);
  return nodes
    .filter((node) => {
      const kinds = collectNodeKinds(node);
      return kinds.has(normalizedServiceType) || normalizeEdgeType(node.type) === normalizedServiceType;
    })
    .map((node) => node.id)
    .sort();
}

export function selectByNodeId(nodeId: string): readonly string[] {
  return [nodeId];
}

export function selectDatastores(
  nodes: readonly InfraNodeAttrs[],
  serviceId: string,
  services: readonly Service[] = [],
): readonly string[] {
  const service = services.find((candidate) => candidate.id === serviceId);
  if (service) {
    return service.resources
      .filter((resource) => {
        const node = nodes.find((candidate) => candidate.id === resource.nodeId);
        return (resource.role ?? (node ? classifyResourceRole(node) : 'other')) === 'datastore';
      })
      .map((resource) => resource.nodeId)
      .sort();
  }

  return nodes
    .filter(
      (node) =>
        classifyResourceRole(node) === 'datastore' &&
        resolveServiceIdFromNode(node) === serviceId,
    )
    .map((node) => node.id)
    .sort();
}

function resolveServiceIdFromNode(node: InfraNodeAttrs): string | null {
  return (
    resolveTagValue(node, 'service') ??
    resolveTagValue(node, 'app') ??
    resolveTagValue(node, 'application') ??
    resolveTagValue(node, 'workload') ??
    resolveTagValue(node, 'project') ??
    readString(getMetadata(node).serviceId)
  );
}

function resolveRegion(node: InfraNodeAttrs): string | null {
  return node.region ?? readString(getMetadata(node).region);
}

function getAvailability(node: InfraNodeAttrs): string | null {
  return node.availabilityZone ?? readString(getMetadata(node).availabilityZone);
}
