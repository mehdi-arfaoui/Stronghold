import type { InfraNode, ValidationEdge } from '../validation/validation-types.js';
import {
  detectCloudFormationServices,
  detectTagServices,
  detectTopologyServices,
} from './detection-strategies/index.js';
import type { Service, ServiceDetectionResult } from './service-types.js';

export function detectServices(
  nodes: readonly InfraNode[],
  edges: ReadonlyArray<ValidationEdge>,
  options: {
    readonly onLog?: (message: string) => void;
  } = {},
): ServiceDetectionResult {
  const assignedNodeIds = new Set<string>();
  const detectedServices: Service[] = [];

  const cloudformationServices = detectCloudFormationServices(nodes, assignedNodeIds, options);
  registerServices(cloudformationServices, assignedNodeIds, detectedServices);

  const tagServices = detectTagServices(nodes, assignedNodeIds);
  registerServices(tagServices, assignedNodeIds, detectedServices);

  const topologyServices = detectTopologyServices(nodes, edges, assignedNodeIds);
  registerServices(topologyServices, assignedNodeIds, detectedServices);

  const unassignedResources = nodes
    .map((node) => node.id)
    .filter((nodeId) => !assignedNodeIds.has(nodeId));

  return {
    services: detectedServices.sort((left, right) => left.name.localeCompare(right.name)),
    unassignedResources,
    detectionSummary: {
      cloudformation: cloudformationServices.length,
      tag: tagServices.length,
      topology: topologyServices.length,
      manual: 0,
      totalResources: nodes.length,
      assignedResources: assignedNodeIds.size,
      unassignedResources: unassignedResources.length,
    },
  };
}

function registerServices(
  services: readonly Service[],
  assignedNodeIds: Set<string>,
  target: Service[],
): void {
  for (const service of services) {
    target.push(service);
    for (const resource of service.resources) {
      assignedNodeIds.add(resource.nodeId);
    }
  }
}
