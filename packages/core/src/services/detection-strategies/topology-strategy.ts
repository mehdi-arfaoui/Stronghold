import type { InfraNode, ValidationEdge } from '../../validation/validation-types.js';
import type { DetectionSource, Service } from '../service-types.js';
import {
  classifyResourceRole,
  cleanServiceName,
  deriveCriticality,
  extractPrefixCandidate,
  hasSharedAvailabilityPattern,
  normalizeEdgeType,
  readNameTag,
  slugifyServiceId,
} from '../service-utils.js';

const APPLICATION_EDGE_TYPES = new Set([
  'depends_on',
  'triggers',
  'publishes_to',
  'subscribes_to',
  'connects_to',
  'routes_to',
]);

const BASE_CONFIDENCE = 0.3;
const EDGE_CONFIDENCE_INCREMENT = 0.1;
const AZ_PATTERN_INCREMENT = 0.05;
const MAX_CONFIDENCE = 0.6;
const MIN_CONFIDENCE = 0.4;

export function detectTopologyServices(
  nodes: readonly InfraNode[],
  edges: ReadonlyArray<ValidationEdge>,
  assignedNodeIds: ReadonlySet<string> = new Set<string>(),
): readonly Service[] {
  const eligibleNodes = nodes.filter((node) => !assignedNodeIds.has(node.id));
  const eligibleNodeIds = new Set(eligibleNodes.map((node) => node.id));
  const nodeById = new Map(eligibleNodes.map((node) => [node.id, node] as const));
  const relevantEdges = edges.filter(
    (edge) =>
      eligibleNodeIds.has(edge.source) &&
      eligibleNodeIds.has(edge.target) &&
      APPLICATION_EDGE_TYPES.has(normalizeEdgeType(edge.type)),
  );

  const adjacency = new Map<string, Set<string>>();
  for (const node of eligibleNodes) {
    adjacency.set(node.id, new Set());
  }
  for (const edge of relevantEdges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const visited = new Set<string>();
  const services: Service[] = [];
  let clusterIndex = 1;

  for (const node of eligibleNodes) {
    if (visited.has(node.id)) continue;

    const componentIds = traverseComponent(node.id, adjacency, visited);
    if (componentIds.length < 2) continue;

    const componentNodes = componentIds
      .map((componentId) => nodeById.get(componentId))
      .filter((candidate): candidate is InfraNode => candidate !== undefined);
    const componentEdges = relevantEdges.filter(
      (edge) => componentIds.includes(edge.source) && componentIds.includes(edge.target),
    );
    const confidence = Math.min(
      MAX_CONFIDENCE,
      BASE_CONFIDENCE +
        componentEdges.length * EDGE_CONFIDENCE_INCREMENT +
        (hasSharedAvailabilityPattern(componentNodes) ? AZ_PATTERN_INCREMENT : 0),
    );

    if (confidence < MIN_CONFIDENCE) continue;

    const clusterName = resolveClusterName(componentNodes, clusterIndex);
    const detectionSource: DetectionSource = {
      type: 'topology',
      algorithm: 'connected-components',
      confidence,
    };
    services.push({
      id: slugifyServiceId(clusterName) || `cluster-${clusterIndex}`,
      name: clusterName,
      detectionSource,
      resources: componentNodes.map((componentNode) => ({
        nodeId: componentNode.id,
        role: classifyResourceRole(componentNode),
        detectionSource,
      })),
      criticality: deriveCriticality(componentNodes),
      metadata: {
        clusterConfidence: confidence,
      },
    });
    clusterIndex += 1;
  }

  return services.sort((left, right) => left.name.localeCompare(right.name));
}

function traverseComponent(
  startNodeId: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  visited: Set<string>,
): readonly string[] {
  const queue = [startNodeId];
  const component: string[] = [];

  while (queue.length > 0) {
    const currentNodeId = queue.shift();
    if (!currentNodeId || visited.has(currentNodeId)) continue;

    visited.add(currentNodeId);
    component.push(currentNodeId);

    for (const neighbor of adjacency.get(currentNodeId) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return component;
}

function resolveClusterName(nodes: readonly InfraNode[], clusterIndex: number): string {
  const candidates = nodes
    .map((node) => readNameTag(node) ?? node.name)
    .filter((candidate) => candidate.trim().length > 0);
  const sharedPrefix = candidates
    .map((candidate) => extractPrefixCandidate(candidate))
    .find((candidate): candidate is string => candidate !== null);

  if (sharedPrefix) {
    return cleanServiceName(sharedPrefix);
  }

  const descriptive = candidates
    .slice()
    .sort((left, right) => right.length - left.length || left.localeCompare(right))[0];
  return descriptive ? cleanServiceName(descriptive) : `cluster-${clusterIndex}`;
}
