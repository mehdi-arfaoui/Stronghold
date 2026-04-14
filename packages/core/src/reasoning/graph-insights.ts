import type { GovernanceConfig } from '../governance/governance-types.js';
import type { GovernanceState } from '../governance/risk-acceptance.js';
import { isApplicationDependencyEdge } from '../scenarios/index.js';
import type { GraphInsight, ReasoningScanResult } from './reasoning-types.js';

const RECOVERY_CATEGORIES = new Set(['backup', 'replication', 'failover', 'recovery']);

export function detectCascadeFailure(
  serviceId: string,
  scanResult: ReasoningScanResult,
): GraphInsight | null {
  const service = scanResult.servicePosture.services.find((entry) => entry.service.id === serviceId);
  if (!service) {
    return null;
  }

  const nodeIds = new Set(service.service.resources.map((resource) => resource.nodeId));
  const serviceByNodeId = buildServiceByNodeId(scanResult);
  const candidates = scanResult.nodes
    .filter((node) => nodeIds.has(node.id))
    .filter((node) => node.isSPOF === true || (node.blastRadius ?? 0) > 2)
    .map((node) => {
      const paths = traceDependencyPaths(node.id, scanResult.edges, serviceByNodeId);
      const impactedServices = Array.from(
        new Set(
          paths
            .map((path) => path.serviceId)
            .filter(
              (candidate): candidate is string =>
                typeof candidate === 'string' && candidate.length > 0 && candidate !== serviceId,
            ),
        ),
      ).sort((left, right) => left.localeCompare(right));

      return { node, paths, impactedServices };
    })
    .filter((candidate) => candidate.impactedServices.length > 1)
    .sort(
      (left, right) =>
        right.impactedServices.length - left.impactedServices.length ||
        (right.node.blastRadius ?? 0) - (left.node.blastRadius ?? 0) ||
        left.node.id.localeCompare(right.node.id),
    );
  const best = candidates[0];

  if (!best) {
    return null;
  }

  return {
    type: 'cascade_failure',
    severity:
      best.impactedServices.length >= 3
        ? 'critical'
        : best.impactedServices.length >= 2
          ? 'high'
          : 'medium',
    summary: `${best.node.name} is a cascade SPOF for ${best.impactedServices.length} service${best.impactedServices.length === 1 ? '' : 's'}.`,
    detail: `${best.node.name} can propagate failure from ${service.service.name} into ${best.impactedServices.join(', ')}. Blast radius: ${best.node.blastRadius ?? best.paths.length}.`,
    affectedServices: best.impactedServices,
    evidence: best.paths.map((path) => path.path),
  };
}

export function detectSilentDependencyDrift(
  serviceId: string,
  scanResult: ReasoningScanResult,
  previousScanResult: ReasoningScanResult | null,
): GraphInsight | null {
  if (!previousScanResult) {
    return null;
  }

  const currentEdges = collectServiceEdgeFingerprints(scanResult, serviceId);
  const previousEdges = collectServiceEdgeFingerprints(previousScanResult, serviceId);
  const addedEdges = currentEdges.filter((edge) => !previousEdges.some((previous) => previous.key === edge.key));
  const removedEdges = previousEdges.filter((edge) => !currentEdges.some((current) => current.key === edge.key));
  const increaseRatio =
    previousEdges.length === 0 ? (addedEdges.length > 0 ? 1 : 0) : addedEdges.length / previousEdges.length;

  if (addedEdges.length <= 2 && increaseRatio <= 0.3) {
    return null;
  }

  return {
    type: 'silent_dependency_drift',
    severity: addedEdges.length >= 4 || increaseRatio > 0.5 ? 'high' : 'medium',
    summary: `${addedEdges.length} new dependency edge${addedEdges.length === 1 ? '' : 's'} appeared since the last scan.`,
    detail: `Service ${serviceId} added ${addedEdges.length} dependency edge${addedEdges.length === 1 ? '' : 's'} and removed ${removedEdges.length}. Blast radius changed from ${resolveServiceBlastRadius(previousScanResult, serviceId)} to ${resolveServiceBlastRadius(scanResult, serviceId)}.`,
    affectedServices: [serviceId],
    evidence: addedEdges.map((edge) => edge.label),
  };
}

export function detectRiskAcceptanceInvalidation(
  serviceId: string,
  scanResult: ReasoningScanResult,
  governanceConfig: GovernanceConfig | GovernanceState | null,
  previousScanResult: ReasoningScanResult | null,
): GraphInsight | null {
  if (!governanceConfig || !previousScanResult) {
    return null;
  }

  const service = scanResult.servicePosture.services.find((entry) => entry.service.id === serviceId);
  if (!service) {
    return null;
  }

  const nodeIds = new Set(service.service.resources.map((resource) => resource.nodeId));
  const currentFindingKeys = new Set(
    scanResult.validationReport.results
      .filter((result) => nodeIds.has(result.nodeId))
      .filter((result) => result.status === 'fail' || result.status === 'error' || result.status === 'warn')
      .map((result) => `${result.ruleId}::${result.nodeId}`),
  );
  const acceptances = governanceConfig.riskAcceptances.filter((acceptance) => {
    const isActive = !('status' in acceptance) || acceptance.status === 'active';
    return isActive && currentFindingKeys.has(acceptance.findingKey);
  });
  const currentServiceByNodeId = buildServiceByNodeId(scanResult);
  const previousServiceByNodeId = buildServiceByNodeId(previousScanResult);
  const candidates = acceptances
    .map((acceptance) => {
      const nodeId = acceptance.findingKey.split('::')[1] ?? '';
      if (!nodeIds.has(nodeId)) {
        return null;
      }

      const currentNode = scanResult.nodes.find((node) => node.id === nodeId);
      const previousNode = previousScanResult.nodes.find((node) => node.id === nodeId);
      if (!currentNode || !previousNode) {
        return null;
      }

      const currentDependents = collectDependentServices(nodeId, scanResult.edges, currentServiceByNodeId, serviceId);
      const previousDependents = collectDependentServices(
        nodeId,
        previousScanResult.edges,
        previousServiceByNodeId,
        serviceId,
      );
      const newDependents = currentDependents.filter(
        (dependent) => !previousDependents.includes(dependent),
      );
      const blastDelta = (currentNode.blastRadius ?? 0) - (previousNode.blastRadius ?? 0);

      if (blastDelta <= 0 && newDependents.length === 0) {
        return null;
      }

      return {
        acceptance,
        blastDelta,
        currentBlastRadius: currentNode.blastRadius ?? 0,
        newDependents,
      };
    })
    .filter(isNonNull)
    .sort(
      (left, right) =>
        right.blastDelta - left.blastDelta ||
        right.newDependents.length - left.newDependents.length ||
        left.acceptance.findingKey.localeCompare(right.acceptance.findingKey),
    );
  const best = candidates[0];

  if (!best) {
    return null;
  }

  return {
    type: 'risk_acceptance_invalidation',
    severity: best.blastDelta > 1 || best.newDependents.length > 1 ? 'high' : 'medium',
    summary: `Risk acceptance ${best.acceptance.findingKey} no longer matches the current blast radius.`,
    detail: `Accepted finding ${best.acceptance.findingKey} was justified as "${best.acceptance.justification}". Blast radius is now ${best.currentBlastRadius}${best.newDependents.length > 0 ? ` and newly affects ${best.newDependents.join(', ')}` : ''}.`,
    affectedServices: [serviceId, ...best.newDependents].sort((left, right) => left.localeCompare(right)),
    evidence: [
      ...(best.blastDelta > 0 ? [`blast radius increased by ${best.blastDelta}`] : []),
      ...best.newDependents.map((dependent) => `new dependent service: ${dependent}`),
    ],
  };
}

export function detectRecoveryPathErosion(
  serviceId: string,
  scanResult: ReasoningScanResult,
  previousScanResult: ReasoningScanResult | null,
): GraphInsight | null {
  if (!previousScanResult) {
    return null;
  }

  const currentStates = collectRecoveryRuleStates(scanResult, serviceId);
  const previousStates = collectRecoveryRuleStates(previousScanResult, serviceId);
  const regressed = previousStates
    .filter((previous) => previous.status === 'pass')
    .map((previous) => {
      const current = currentStates.find((entry) => entry.key === previous.key);
      return current && current.status !== 'pass'
        ? `${previous.ruleId}: pass -> ${current.status}`
        : null;
    })
    .filter((entry): entry is string => entry !== null)
    .sort((left, right) => left.localeCompare(right));

  if (regressed.length === 0) {
    return null;
  }

  const remainingPaths = currentStates.filter((entry) => entry.status === 'pass').length;

  return {
    type: 'recovery_path_erosion',
    severity: remainingPaths === 0 ? 'critical' : regressed.length >= 2 ? 'high' : 'medium',
    summary: `${serviceId} lost ${regressed.length} recovery mechanism${regressed.length === 1 ? '' : 's'} since the previous scan.`,
    detail: `Recovery coverage regressed on ${regressed.length} rule${regressed.length === 1 ? '' : 's'}. Remaining recovery paths: ${remainingPaths}.`,
    affectedServices: [serviceId],
    evidence: regressed,
  };
}

function buildServiceByNodeId(scanResult: ReasoningScanResult): ReadonlyMap<string, string> {
  return new Map(
    scanResult.servicePosture.services.flatMap((service) =>
      service.service.resources.map((resource) => [resource.nodeId, service.service.id] as const),
    ),
  );
}

function traceDependencyPaths(
  sourceNodeId: string,
  edges: ReasoningScanResult['edges'],
  serviceByNodeId: ReadonlyMap<string, string>,
): ReadonlyArray<{
  readonly serviceId: string | null;
  readonly path: string;
}> {
  const adjacency = buildDependentAdjacency(edges);
  const queue: Array<{ readonly nodeId: string; readonly segments: readonly string[]; readonly depth: number }> = [
    { nodeId: sourceNodeId, segments: [], depth: 0 },
  ];
  const seen = new Set([sourceNodeId]);
  const paths: Array<{ readonly serviceId: string | null; readonly path: string }> = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= 10) {
      continue;
    }

    const links = adjacency.get(current.nodeId) ?? [];
    links.forEach((link) => {
      const segment = `${current.nodeId} -> ${link.nodeId} (${link.edgeType})`;
      const nextSegments = [...current.segments, segment];
      const serviceId = serviceByNodeId.get(link.nodeId) ?? null;
      if (serviceId) {
        paths.push({
          serviceId,
          path: nextSegments.join(' -> '),
        });
      }
      if (!seen.has(link.nodeId)) {
        seen.add(link.nodeId);
        queue.push({
          nodeId: link.nodeId,
          segments: nextSegments,
          depth: current.depth + 1,
        });
      }
    });
  }

  return paths.sort(
    (left, right) =>
      (left.serviceId ?? '').localeCompare(right.serviceId ?? '') || left.path.localeCompare(right.path),
  );
}

function collectServiceEdgeFingerprints(
  scanResult: ReasoningScanResult,
  serviceId: string,
): ReadonlyArray<{ readonly key: string; readonly label: string }> {
  const nodeIds = new Set(
    scanResult.servicePosture.services
      .find((entry) => entry.service.id === serviceId)
      ?.service.resources.map((resource) => resource.nodeId) ?? [],
  );

  return scanResult.edges
    .filter((edge) => isApplicationDependencyEdge(edge.type))
    .filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target))
    .map((edge) => ({
      key: `${edge.source}->${edge.target}:${edge.type.toLowerCase()}`,
      label: `${edge.source} -> ${edge.target} (${edge.type.toLowerCase()})`,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function resolveServiceBlastRadius(scanResult: ReasoningScanResult, serviceId: string): number {
  const nodeIds = new Set(
    scanResult.servicePosture.services
      .find((entry) => entry.service.id === serviceId)
      ?.service.resources.map((resource) => resource.nodeId) ?? [],
  );

  return scanResult.nodes
    .filter((node) => nodeIds.has(node.id))
    .reduce((max, node) => Math.max(max, node.blastRadius ?? 0), 0);
}

function collectDependentServices(
  nodeId: string,
  edges: ReasoningScanResult['edges'],
  serviceByNodeId: ReadonlyMap<string, string>,
  excludeServiceId: string,
): readonly string[] {
  return Array.from(
    new Set(
      traceDependencyPaths(nodeId, edges, serviceByNodeId)
        .map((path) => path.serviceId)
        .filter(
          (serviceId): serviceId is string =>
            typeof serviceId === 'string' && serviceId.length > 0 && serviceId !== excludeServiceId,
        ),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function collectRecoveryRuleStates(
  scanResult: ReasoningScanResult,
  serviceId: string,
): ReadonlyArray<{
  readonly key: string;
  readonly ruleId: string;
  readonly status: string;
}> {
  const nodeIds = new Set(
    scanResult.servicePosture.services
      .find((entry) => entry.service.id === serviceId)
      ?.service.resources.map((resource) => resource.nodeId) ?? [],
  );

  return scanResult.validationReport.results
    .filter((result) => nodeIds.has(result.nodeId))
    .filter((result) => RECOVERY_CATEGORIES.has(result.category))
    .map((result) => ({
      key: `${result.ruleId}::${result.nodeId}`,
      ruleId: result.ruleId,
      status: result.status,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function buildDependentAdjacency(
  edges: ReasoningScanResult['edges'],
): ReadonlyMap<string, ReadonlyArray<{ readonly nodeId: string; readonly edgeType: string }>> {
  const adjacency = new Map<string, Array<{ readonly nodeId: string; readonly edgeType: string }>>();

  edges.forEach((edge) => {
    if (!isApplicationDependencyEdge(edge.type)) {
      return;
    }

    const normalizedType = edge.type.toLowerCase();
    const dependency =
      normalizedType === 'triggers'
        ? { from: edge.source, to: edge.target }
        : { from: edge.target, to: edge.source };
    const current = adjacency.get(dependency.from) ?? [];
    current.push({
      nodeId: dependency.to,
      edgeType: normalizedType,
    });
    adjacency.set(dependency.from, current);
  });

  return new Map(
    Array.from(adjacency.entries(), ([nodeId, links]) => [
      nodeId,
      links
        .slice()
        .sort(
          (left, right) =>
            left.nodeId.localeCompare(right.nodeId) || left.edgeType.localeCompare(right.edgeType),
        ),
    ]),
  );
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}
