import type {
  Service,
  ServiceDetectionResult,
  ServiceDetectionSummary,
} from './service-types.js';

export function mergeServices(
  autoDetected: ServiceDetectionResult,
  manualServices: readonly Service[],
): ServiceDetectionResult {
  if (manualServices.length === 0) {
    return autoDetected;
  }

  const manualResourceIds = new Set(
    manualServices.flatMap((service) => service.resources.map((resource) => resource.nodeId)),
  );

  const remainingAutoServices = autoDetected.services
    .map((service) => ({
      ...service,
      resources: service.resources.filter((resource) => !manualResourceIds.has(resource.nodeId)),
    }))
    .filter((service) => service.resources.length > 0);

  const mergedServices = [...manualServices, ...remainingAutoServices];
  const unassignedResources = autoDetected.unassignedResources.filter(
    (nodeId) => !manualResourceIds.has(nodeId),
  );

  return {
    services: mergedServices,
    unassignedResources,
    detectionSummary: summarizeMergedServices(
      mergedServices,
      autoDetected.detectionSummary.totalResources,
      unassignedResources.length,
    ),
  };
}

function summarizeMergedServices(
  services: readonly Service[],
  totalResources: number,
  unassignedResources: number,
): ServiceDetectionSummary {
  const counts = {
    cloudformation: 0,
    tag: 0,
    topology: 0,
    manual: 0,
  };

  for (const service of services) {
    if (service.detectionSource.type === 'cloudformation') counts.cloudformation += 1;
    if (service.detectionSource.type === 'tag') counts.tag += 1;
    if (service.detectionSource.type === 'topology') counts.topology += 1;
    if (service.detectionSource.type === 'manual') counts.manual += 1;
  }

  return {
    ...counts,
    totalResources,
    assignedResources: totalResources - unassignedResources,
    unassignedResources,
  };
}
