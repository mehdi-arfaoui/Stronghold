/**
 * Types and constants for graph scenario propagation delay modeling.
 */

import { EdgeType, NodeType } from '../types/index.js';

export type PropagationDelayKey =
  | 'api_call'
  | 'database_connection'
  | 'load_balancer'
  | 'message_queue'
  | 'event_stream'
  | 'cache_dependency'
  | 'network_access'
  | 'dns_resolution'
  | 'storage_mount'
  | 'manual_failover'
  | 'alerting_pipeline'
  | 'default';

type PropagationDelayProfile = {
  readonly minSeconds: number;
  readonly maxSeconds: number;
  readonly description: string;
};

export type NormalizedDependencyEdge = {
  readonly dependencyId: string;
  readonly dependentId: string;
  readonly rawEdgeType: string;
  readonly propagationEdgeType: PropagationDelayKey;
};

export type PropagationAttempt = {
  readonly dependencyId: string;
  readonly dependentId: string;
  readonly rawEdgeType: string;
  readonly propagationEdgeType: PropagationDelayKey;
  readonly delaySeconds: number;
  readonly depth: number;
};

export type NodePropagationState = {
  currentStatus: 'healthy' | 'degraded' | 'down';
  unavailableDependencies: Set<string>;
  earliestImpactSeconds: number;
  latestEventSeconds: number;
  cascadeDepth: number;
  parentNodeId: string | null;
  rawEdgeType: string | null;
  propagationEdgeType: PropagationDelayKey | null;
  cascadeReason: string;
};

export const PROPAGATION_DELAYS: Record<PropagationDelayKey, PropagationDelayProfile> = {
  api_call: { minSeconds: 5, maxSeconds: 30, description: 'Timeout de connexion API' },
  database_connection: { minSeconds: 3, maxSeconds: 15, description: 'Pool de connexions epuise' },
  load_balancer: { minSeconds: 2, maxSeconds: 10, description: 'Health check failure' },
  message_queue: {
    minSeconds: 30,
    maxSeconds: 300,
    description: 'Queue qui se remplit, consumers bloques',
  },
  event_stream: { minSeconds: 60, maxSeconds: 600, description: 'Backpressure et lag accumule' },
  cache_dependency: {
    minSeconds: 10,
    maxSeconds: 60,
    description: 'Cache miss et fallback sur la source primaire',
  },
  network_access: { minSeconds: 1, maxSeconds: 5, description: 'Reseau inaccessible' },
  dns_resolution: { minSeconds: 30, maxSeconds: 120, description: 'TTL DNS et propagation' },
  storage_mount: { minSeconds: 5, maxSeconds: 30, description: 'I/O timeout sur le volume' },
  manual_failover: {
    minSeconds: 300,
    maxSeconds: 1800,
    description: 'Intervention humaine necessaire',
  },
  alerting_pipeline: {
    minSeconds: 60,
    maxSeconds: 300,
    description: 'Temps de detection et de notification',
  },
  default: { minSeconds: 15, maxSeconds: 120, description: 'Impact estime' },
};

export const NON_PROPAGATING_EDGE_TYPES = new Set<string>([
  EdgeType.CONTAINS,
  EdgeType.BACKS_UP_TO,
  EdgeType.REPLICATES_TO,
  EdgeType.PLACED_IN,
  EdgeType.SECURED_BY,
  EdgeType.IAM_ACCESS,
]);

const NETWORK_NODE_TYPES = new Set<string>([
  NodeType.VPC,
  NodeType.SUBNET,
  NodeType.NETWORK_DEVICE,
  NodeType.FIREWALL,
  NodeType.DATA_CENTER,
  NodeType.AVAILABILITY_ZONE,
  NodeType.REGION,
]);

export function isNetworkNode(nodeType: string): boolean {
  return NETWORK_NODE_TYPES.has(nodeType);
}

export function roundSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function toMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round((seconds / 60) * 100) / 100;
}

export function stableUnitInterval(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) + 0.5) / 4294967296;
}

export function calculatePropagationDelay(edgeType: PropagationDelayKey, seed: string): number {
  const config = PROPAGATION_DELAYS[edgeType] ?? PROPAGATION_DELAYS.default;
  const { minSeconds, maxSeconds } = config;
  const mode = (minSeconds + maxSeconds) / 2;
  const threshold = (mode - minSeconds) / (maxSeconds - minSeconds);
  const u = stableUnitInterval(seed);

  if (u < threshold) {
    return minSeconds + Math.sqrt(u * (maxSeconds - minSeconds) * (mode - minSeconds));
  }
  return maxSeconds - Math.sqrt((1 - u) * (maxSeconds - minSeconds) * (maxSeconds - mode));
}

export function inferPropagationEdgeType(
  rawEdgeType: string,
  dependencyNodeType: string,
  dependentNodeType: string,
): PropagationDelayKey {
  switch (rawEdgeType) {
    case EdgeType.ROUTES_TO:
      if (dependencyNodeType === NodeType.DNS || dependentNodeType === NodeType.DNS)
        return 'dns_resolution';
      if (
        [NodeType.LOAD_BALANCER, NodeType.API_GATEWAY, NodeType.CDN].includes(
          dependencyNodeType as NodeType,
        )
      )
        return 'load_balancer';
      return 'api_call';
    case EdgeType.CONNECTS_TO:
    case EdgeType.USES:
      if (dependencyNodeType === NodeType.DATABASE) return 'database_connection';
      if (dependencyNodeType === NodeType.CACHE) return 'cache_dependency';
      if (
        dependencyNodeType === NodeType.OBJECT_STORAGE ||
        dependencyNodeType === NodeType.FILE_STORAGE
      )
        return 'storage_mount';
      if (dependencyNodeType === NodeType.MESSAGE_QUEUE) return 'message_queue';
      if (isNetworkNode(dependencyNodeType)) return 'network_access';
      return 'api_call';
    case EdgeType.DEPENDS_ON:
    case EdgeType.AUTHENTICATES_VIA:
      if (dependencyNodeType === NodeType.DATABASE) return 'database_connection';
      if (dependencyNodeType === NodeType.CACHE) return 'cache_dependency';
      if (dependencyNodeType === NodeType.MESSAGE_QUEUE) return 'message_queue';
      if (dependencyNodeType === NodeType.DNS) return 'dns_resolution';
      if (
        dependencyNodeType === NodeType.OBJECT_STORAGE ||
        dependencyNodeType === NodeType.FILE_STORAGE
      )
        return 'storage_mount';
      if (isNetworkNode(dependencyNodeType)) return 'network_access';
      return 'api_call';
    case EdgeType.PUBLISHES_TO:
    case EdgeType.SUBSCRIBES_TO:
    case EdgeType.PUBLISHES_TO_APPLICATIVE:
    case EdgeType.TRIGGERS:
    case EdgeType.DEAD_LETTER:
      return dependencyNodeType === NodeType.MESSAGE_QUEUE ? 'message_queue' : 'event_stream';
    case EdgeType.RUNS_ON:
    case EdgeType.NETWORK_ACCESS:
      return isNetworkNode(dependencyNodeType) ? 'network_access' : 'manual_failover';
    case EdgeType.MONITORS:
      return 'alerting_pipeline';
    default:
      if (dependencyNodeType === NodeType.DATABASE) return 'database_connection';
      if (dependencyNodeType === NodeType.CACHE) return 'cache_dependency';
      if (dependencyNodeType === NodeType.MESSAGE_QUEUE) return 'message_queue';
      if (dependencyNodeType === NodeType.DNS) return 'dns_resolution';
      if (isNetworkNode(dependencyNodeType)) return 'network_access';
      return 'default';
  }
}

export function normalizeDependencyEdge(
  sourceId: string,
  targetId: string,
  rawEdgeType: string,
): { dependencyId: string; dependentId: string } {
  switch (rawEdgeType) {
    case EdgeType.TRIGGERS:
    case EdgeType.PUBLISHES_TO_APPLICATIVE:
      return { dependencyId: sourceId, dependentId: targetId };
    default:
      return { dependencyId: targetId, dependentId: sourceId };
  }
}
