import type { GraphInstance } from './graphService.js';
import type {
  CascadeNode,
  InfraNodeAttrs,
  SimulationBusinessImpact,
  SimulationPropagationEvent,
  WarRoomData,
} from './types.js';
import { EdgeType, NodeType } from './types.js';

type PropagationDelayProfile = {
  minSeconds: number;
  maxSeconds: number;
  description: string;
};

type PropagationDelayKey =
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

type NormalizedDependencyEdge = {
  dependencyId: string;
  dependentId: string;
  rawEdgeType: string;
  propagationEdgeType: PropagationDelayKey;
};

type PropagationAttempt = {
  dependencyId: string;
  dependentId: string;
  rawEdgeType: string;
  propagationEdgeType: PropagationDelayKey;
  delaySeconds: number;
  depth: number;
};

type NodePropagationState = {
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

const PROPAGATION_DELAYS: Record<PropagationDelayKey, PropagationDelayProfile> = {
  api_call: { minSeconds: 5, maxSeconds: 30, description: 'Timeout de connexion API' },
  database_connection: { minSeconds: 3, maxSeconds: 15, description: 'Pool de connexions epuise' },
  load_balancer: { minSeconds: 2, maxSeconds: 10, description: 'Health check failure' },
  message_queue: { minSeconds: 30, maxSeconds: 300, description: 'Queue qui se remplit, consumers bloques' },
  event_stream: { minSeconds: 60, maxSeconds: 600, description: 'Backpressure et lag accumule' },
  cache_dependency: { minSeconds: 10, maxSeconds: 60, description: 'Cache miss et fallback sur la source primaire' },
  network_access: { minSeconds: 1, maxSeconds: 5, description: 'Reseau inaccessible' },
  dns_resolution: { minSeconds: 30, maxSeconds: 120, description: 'TTL DNS et propagation' },
  storage_mount: { minSeconds: 5, maxSeconds: 30, description: 'I/O timeout sur le volume' },
  manual_failover: { minSeconds: 300, maxSeconds: 1800, description: 'Intervention humaine necessaire' },
  alerting_pipeline: { minSeconds: 60, maxSeconds: 300, description: 'Temps de detection et de notification' },
  default: { minSeconds: 15, maxSeconds: 120, description: 'Impact estime' },
};

const NON_PROPAGATING_EDGE_TYPES = new Set<string>([
  EdgeType.CONTAINS,
  EdgeType.BACKS_UP_TO,
  EdgeType.REPLICATES_TO,
  EdgeType.PLACED_IN,
  EdgeType.SECURED_BY,
  EdgeType.IAM_ACCESS,
]);

function roundSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function toMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round((seconds / 60) * 100) / 100;
}

function stableUnitInterval(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) + 0.5) / 4294967296;
}

function calculatePropagationDelay(
  edgeType: PropagationDelayKey,
  seed: string,
): number {
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

function isNetworkNode(nodeType: string): boolean {
  return new Set<string>([
    NodeType.VPC,
    NodeType.SUBNET,
    NodeType.NETWORK_DEVICE,
    NodeType.FIREWALL,
    NodeType.DATA_CENTER,
    NodeType.AVAILABILITY_ZONE,
    NodeType.REGION,
  ]).has(nodeType);
}

function inferPropagationEdgeType(
  rawEdgeType: string,
  dependencyNodeType: string,
  dependentNodeType: string,
): PropagationDelayKey {
  switch (rawEdgeType) {
    case EdgeType.ROUTES_TO:
      if (dependencyNodeType === NodeType.DNS || dependentNodeType === NodeType.DNS) {
        return 'dns_resolution';
      }
      if (
        dependencyNodeType === NodeType.LOAD_BALANCER ||
        dependencyNodeType === NodeType.API_GATEWAY ||
        dependencyNodeType === NodeType.CDN
      ) {
        return 'load_balancer';
      }
      return 'api_call';
    case EdgeType.CONNECTS_TO:
    case EdgeType.USES:
      if (dependencyNodeType === NodeType.DATABASE) return 'database_connection';
      if (dependencyNodeType === NodeType.CACHE) return 'cache_dependency';
      if (
        dependencyNodeType === NodeType.OBJECT_STORAGE ||
        dependencyNodeType === NodeType.FILE_STORAGE
      ) {
        return 'storage_mount';
      }
      if (dependencyNodeType === NodeType.MESSAGE_QUEUE) return 'message_queue';
      if (isNetworkNode(dependencyNodeType)) return 'network_access';
      return 'api_call';
    case EdgeType.DEPENDS_ON:
    case EdgeType.AUTHENTICATES_VIA:
      if (dependencyNodeType === NodeType.DATABASE) return 'database_connection';
      if (dependencyNodeType === NodeType.CACHE) return 'cache_dependency';
      if (dependencyNodeType === NodeType.MESSAGE_QUEUE) return 'message_queue';
      if (dependencyNodeType === NodeType.DNS) return 'dns_resolution';
      if (dependencyNodeType === NodeType.OBJECT_STORAGE || dependencyNodeType === NodeType.FILE_STORAGE) {
        return 'storage_mount';
      }
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

function normalizeDependencyEdge(
  sourceId: string,
  targetId: string,
  rawEdgeType: string,
): { dependencyId: string; dependentId: string } {
  switch (rawEdgeType) {
    case EdgeType.TRIGGERS:
    case EdgeType.PUBLISHES_TO_APPLICATIVE:
      return {
        dependencyId: sourceId,
        dependentId: targetId,
      };
    case EdgeType.PUBLISHES_TO:
    case EdgeType.NETWORK_ACCESS:
    case EdgeType.USES:
    case EdgeType.CONNECTS_TO:
    case EdgeType.DEPENDS_ON:
    case EdgeType.ROUTES_TO:
    case EdgeType.SUBSCRIBES_TO:
    case EdgeType.RUNS_ON:
    case EdgeType.AUTHENTICATES_VIA:
    case EdgeType.MONITORS:
    case EdgeType.DEAD_LETTER:
    default:
      return {
        dependencyId: targetId,
        dependentId: sourceId,
      };
  }
}

function toImpactSeverity(
  impactType: SimulationPropagationEvent['impactType'],
): SimulationPropagationEvent['impactSeverity'] {
  if (impactType === 'initial_failure') return 'critical';
  if (impactType === 'direct_cascade') return 'major';
  return 'minor';
}

function describeInitialFailure(node: InfraNodeAttrs): string {
  return `${node.name} indisponible suite au scenario initial.`;
}

function describePropagation(params: {
  dependencyNode: InfraNodeAttrs;
  dependentNode: InfraNodeAttrs;
  propagationEdgeType: PropagationDelayKey;
  delaySeconds: number;
  impactType: SimulationPropagationEvent['impactType'];
}): string {
  const delayProfile = PROPAGATION_DELAYS[params.propagationEdgeType] ?? PROPAGATION_DELAYS.default;
  const cascadeLabel =
    params.impactType === 'degraded'
      ? 'degrade'
      : params.impactType === 'direct_cascade'
        ? 'impact direct'
        : 'impact en cascade';
  return `${params.dependencyNode.name} indisponible -> ${params.dependentNode.name} ${cascadeLabel} (${delayProfile.description}) apres ${roundSeconds(params.delaySeconds)}s.`;
}

function buildDependencyGraph(graph: GraphInstance): {
  dependentsByDependency: Map<string, NormalizedDependencyEdge[]>;
  dependencyIdsByDependent: Map<string, Set<string>>;
} {
  const dependentsByDependency = new Map<string, NormalizedDependencyEdge[]>();
  const dependencyIdsByDependent = new Map<string, Set<string>>();

  for (const edgeKey of graph.edges()) {
    const attrs = graph.getEdgeAttributes(edgeKey) as { type?: string };
    const rawEdgeType = String(attrs.type || '');
    if (NON_PROPAGATING_EDGE_TYPES.has(rawEdgeType)) continue;

    const sourceId = graph.source(edgeKey);
    const targetId = graph.target(edgeKey);
    if (!graph.hasNode(sourceId) || !graph.hasNode(targetId)) continue;

    const normalized = normalizeDependencyEdge(sourceId, targetId, rawEdgeType);
    if (normalized.dependencyId === normalized.dependentId) continue;

    const dependencyNode = graph.getNodeAttributes(normalized.dependencyId) as InfraNodeAttrs;
    const dependentNode = graph.getNodeAttributes(normalized.dependentId) as InfraNodeAttrs;
    const propagationEdgeType = inferPropagationEdgeType(
      rawEdgeType,
      String(dependencyNode.type || ''),
      String(dependentNode.type || ''),
    );

    const edge: NormalizedDependencyEdge = {
      dependencyId: normalized.dependencyId,
      dependentId: normalized.dependentId,
      rawEdgeType,
      propagationEdgeType,
    };

    if (!dependentsByDependency.has(edge.dependencyId)) {
      dependentsByDependency.set(edge.dependencyId, []);
    }
    dependentsByDependency.get(edge.dependencyId)!.push(edge);

    if (!dependencyIdsByDependent.has(edge.dependentId)) {
      dependencyIdsByDependent.set(edge.dependentId, new Set<string>());
    }
    dependencyIdsByDependent.get(edge.dependentId)!.add(edge.dependencyId);
  }

  return { dependentsByDependency, dependencyIdsByDependent };
}

function pushPropagationAttempt(
  queue: PropagationAttempt[],
  attempt: PropagationAttempt,
): void {
  queue.push(attempt);
  queue.sort((left, right) => left.delaySeconds - right.delaySeconds);
}

export function buildSimulationPropagation(input: {
  graph: GraphInstance;
  initialFailureNodeIds: string[];
  businessImpact: SimulationBusinessImpact[];
  scenarioType: string;
}): Pick<WarRoomData, 'propagationTimeline' | 'impactedNodes'> & {
  cascadeNodes: CascadeNode[];
} {
  const { dependentsByDependency, dependencyIdsByDependent } = buildDependencyGraph(input.graph);
  const propagationTimeline: SimulationPropagationEvent[] = [];
  const stateByNodeId = new Map<string, NodePropagationState>();
  const attempts: PropagationAttempt[] = [];
  const businessImpactByServiceId = new Map(
    input.businessImpact.map((service) => [service.serviceId, service] as const),
  );

  const initialNodes = input.initialFailureNodeIds
    .filter((nodeId) => input.graph.hasNode(nodeId))
    .sort((left, right) => left.localeCompare(right));

  for (const nodeId of initialNodes) {
    const node = input.graph.getNodeAttributes(nodeId) as InfraNodeAttrs;
    stateByNodeId.set(nodeId, {
      currentStatus: 'down',
      unavailableDependencies: new Set<string>(),
      earliestImpactSeconds: 0,
      latestEventSeconds: 0,
      cascadeDepth: 0,
      parentNodeId: null,
      rawEdgeType: null,
      propagationEdgeType: null,
      cascadeReason: describeInitialFailure(node),
    });
    propagationTimeline.push({
      timestampMinutes: 0,
      delaySeconds: 0,
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      impactType: 'initial_failure',
      impactSeverity: 'critical',
      edgeType: 'initial',
      parentNodeId: null,
      parentNodeName: null,
      description: describeInitialFailure(node),
    });

    for (const relation of dependentsByDependency.get(nodeId) || []) {
      const delaySeconds = calculatePropagationDelay(
        relation.propagationEdgeType,
        `${input.scenarioType}:${nodeId}:${relation.dependentId}:${relation.rawEdgeType}`,
      );
      pushPropagationAttempt(attempts, {
        dependencyId: nodeId,
        dependentId: relation.dependentId,
        rawEdgeType: relation.rawEdgeType,
        propagationEdgeType: relation.propagationEdgeType,
        delaySeconds,
        depth: 1,
      });
    }
  }

  while (attempts.length > 0) {
    const attempt = attempts.shift();
    if (!attempt) continue;
    if (!input.graph.hasNode(attempt.dependentId) || !input.graph.hasNode(attempt.dependencyId)) {
      continue;
    }

    const previousState = stateByNodeId.get(attempt.dependentId) ?? {
      currentStatus: 'healthy',
      unavailableDependencies: new Set<string>(),
      earliestImpactSeconds: Number.POSITIVE_INFINITY,
      latestEventSeconds: 0,
      cascadeDepth: attempt.depth,
      parentNodeId: attempt.dependencyId,
      rawEdgeType: attempt.rawEdgeType,
      propagationEdgeType: attempt.propagationEdgeType,
      cascadeReason: '',
    };

    if (previousState.unavailableDependencies.has(attempt.dependencyId)) {
      continue;
    }

    previousState.unavailableDependencies.add(attempt.dependencyId);

    const totalDependencies = Math.max(
      dependencyIdsByDependent.get(attempt.dependentId)?.size ?? 0,
      previousState.unavailableDependencies.size,
    );
    const unavailableDependencies = previousState.unavailableDependencies.size;
    const nextStatus: NodePropagationState['currentStatus'] =
      unavailableDependencies >= totalDependencies ? 'down' : 'degraded';

    if (
      previousState.currentStatus === 'down' ||
      (previousState.currentStatus === 'degraded' && nextStatus === 'degraded')
    ) {
      stateByNodeId.set(attempt.dependentId, previousState);
      continue;
    }

    const dependentNode = input.graph.getNodeAttributes(attempt.dependentId) as InfraNodeAttrs;
    const dependencyNode = input.graph.getNodeAttributes(attempt.dependencyId) as InfraNodeAttrs;
    const impactType: SimulationPropagationEvent['impactType'] =
      nextStatus === 'degraded'
        ? 'degraded'
        : attempt.depth <= 1
          ? 'direct_cascade'
          : 'indirect_cascade';
    const description = describePropagation({
      dependencyNode,
      dependentNode,
      propagationEdgeType: attempt.propagationEdgeType,
      delaySeconds: attempt.delaySeconds,
      impactType,
    });

    stateByNodeId.set(attempt.dependentId, {
      currentStatus: nextStatus,
      unavailableDependencies: previousState.unavailableDependencies,
      earliestImpactSeconds: Math.min(previousState.earliestImpactSeconds, attempt.delaySeconds),
      latestEventSeconds: attempt.delaySeconds,
      cascadeDepth: Math.min(previousState.cascadeDepth, attempt.depth),
      parentNodeId: attempt.dependencyId,
      rawEdgeType: attempt.rawEdgeType,
      propagationEdgeType: attempt.propagationEdgeType,
      cascadeReason:
        nextStatus === 'down'
          ? `${unavailableDependencies}/${totalDependencies} dependances indisponibles`
          : `${unavailableDependencies}/${totalDependencies} dependances indisponibles (service degrade)`,
    });

    propagationTimeline.push({
      timestampMinutes: toMinutes(attempt.delaySeconds),
      delaySeconds: roundSeconds(attempt.delaySeconds),
      nodeId: attempt.dependentId,
      nodeName: dependentNode.name,
      nodeType: dependentNode.type,
      impactType,
      impactSeverity: toImpactSeverity(impactType),
      edgeType: attempt.propagationEdgeType,
      parentNodeId: attempt.dependencyId,
      parentNodeName: dependencyNode.name,
      description,
    });

    if (nextStatus !== 'down') {
      continue;
    }

    for (const relation of dependentsByDependency.get(attempt.dependentId) || []) {
      const additionalDelay = calculatePropagationDelay(
        relation.propagationEdgeType,
        `${input.scenarioType}:${attempt.dependentId}:${relation.dependentId}:${relation.rawEdgeType}`,
      );
      pushPropagationAttempt(attempts, {
        dependencyId: attempt.dependentId,
        dependentId: relation.dependentId,
        rawEdgeType: relation.rawEdgeType,
        propagationEdgeType: relation.propagationEdgeType,
        delaySeconds: attempt.delaySeconds + additionalDelay,
        depth: attempt.depth + 1,
      });
    }
  }

  const cascadeNodes: CascadeNode[] = Array.from(stateByNodeId.entries())
    .filter(([nodeId]) => !initialNodes.includes(nodeId))
    .map(([nodeId, state]) => {
      const node = input.graph.getNodeAttributes(nodeId) as InfraNodeAttrs;
      return {
        id: nodeId,
        name: node.name,
        type: node.type,
        status: state.currentStatus === 'healthy' ? 'degraded' : state.currentStatus,
        cascadeReason: state.cascadeReason || 'Propagation en cascade',
        cascadeDepth: Math.max(1, state.cascadeDepth),
      };
    })
    .sort((left, right) => left.cascadeDepth - right.cascadeDepth || left.name.localeCompare(right.name));

  const impactedNodes: WarRoomData['impactedNodes'] = Array.from(stateByNodeId.entries())
    .map(([nodeId, state]) => {
      const node = input.graph.getNodeAttributes(nodeId) as InfraNodeAttrs;
      const businessService = businessImpactByServiceId.get(nodeId);
      const estimatedRecovery = Math.max(
        1,
        Math.round(
          businessService?.estimatedRTO ??
            node.validatedRTO ??
            node.suggestedRTO ??
            (state.currentStatus === 'down' ? 60 : 20),
        ),
      );
      return {
        id: nodeId,
        name: node.name,
        type: node.type,
        status:
          state.currentStatus === 'healthy'
            ? ('healthy' as const)
            : state.currentStatus === 'degraded'
              ? ('degraded' as const)
              : ('down' as const),
        impactedAt: toMinutes(state.earliestImpactSeconds),
        impactedAtSeconds: roundSeconds(state.earliestImpactSeconds),
        estimatedRecovery,
      };
    })
    .sort((left, right) => left.impactedAtSeconds - right.impactedAtSeconds || left.name.localeCompare(right.name));

  propagationTimeline.sort((left, right) => {
    if (left.delaySeconds === right.delaySeconds) {
      return left.nodeName.localeCompare(right.nodeName);
    }
    return left.delaySeconds - right.delaySeconds;
  });

  return {
    propagationTimeline,
    impactedNodes,
    cascadeNodes,
  };
}
