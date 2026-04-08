/**
 * Graph scenario propagation engine — cascades failures through the graph
 * using realistic delay profiles per edge type.
 */

import type {
  InfraNodeAttrs,
  CascadeNode,
  SimulationBusinessImpact,
  SimulationPropagationEvent,
  WarRoomData,
} from '../types/index.js';
import type { GraphInstance } from './graph-instance.js';
import {
  type NormalizedDependencyEdge,
  type PropagationAttempt,
  type NodePropagationState,
  type PropagationDelayKey,
  NON_PROPAGATING_EDGE_TYPES,
  PROPAGATION_DELAYS,
  roundSeconds,
  toMinutes,
  calculatePropagationDelay,
  inferPropagationEdgeType,
  normalizeDependencyEdge,
} from './graph-scenario-propagation-types.js';

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
  const profile = PROPAGATION_DELAYS[params.propagationEdgeType] ?? PROPAGATION_DELAYS.default;
  const label =
    params.impactType === 'degraded'
      ? 'degrade'
      : params.impactType === 'direct_cascade'
        ? 'impact direct'
        : 'impact en cascade';
  return `${params.dependencyNode.name} indisponible -> ${params.dependentNode.name} ${label} (${profile.description}) apres ${roundSeconds(params.delaySeconds)}s.`;
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

    const depNode = graph.getNodeAttributes(normalized.dependencyId) as unknown as InfraNodeAttrs;
    const deptNode = graph.getNodeAttributes(normalized.dependentId) as unknown as InfraNodeAttrs;
    const propType = inferPropagationEdgeType(
      rawEdgeType,
      String(depNode.type || ''),
      String(deptNode.type || ''),
    );

    const edge: NormalizedDependencyEdge = {
      dependencyId: normalized.dependencyId,
      dependentId: normalized.dependentId,
      rawEdgeType,
      propagationEdgeType: propType,
    };

    if (!dependentsByDependency.has(edge.dependencyId))
      dependentsByDependency.set(edge.dependencyId, []);
    dependentsByDependency.get(edge.dependencyId)!.push(edge);

    if (!dependencyIdsByDependent.has(edge.dependentId))
      dependencyIdsByDependent.set(edge.dependentId, new Set());
    dependencyIdsByDependent.get(edge.dependentId)!.add(edge.dependencyId);
  }

  return { dependentsByDependency, dependencyIdsByDependent };
}

function pushSorted(queue: PropagationAttempt[], attempt: PropagationAttempt): void {
  queue.push(attempt);
  queue.sort((a, b) => a.delaySeconds - b.delaySeconds);
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
  const timeline: SimulationPropagationEvent[] = [];
  const stateByNodeId = new Map<string, NodePropagationState>();
  const attempts: PropagationAttempt[] = [];
  const biMap = new Map(input.businessImpact.map((s) => [s.serviceId, s] as const));

  const initNodes = input.initialFailureNodeIds
    .filter((id) => input.graph.hasNode(id))
    .sort((a, b) => a.localeCompare(b));

  seedInitialFailures(initNodes, input, stateByNodeId, timeline, dependentsByDependency, attempts);
  propagateFailures(
    attempts,
    input,
    stateByNodeId,
    dependencyIdsByDependent,
    dependentsByDependency,
    timeline,
  );

  const cascadeNodes = buildCascadeNodes(stateByNodeId, initNodes, input.graph);
  const impactedNodes = buildImpactedNodes(stateByNodeId, input.graph, biMap);

  timeline.sort((a, b) =>
    a.delaySeconds === b.delaySeconds
      ? a.nodeName.localeCompare(b.nodeName)
      : a.delaySeconds - b.delaySeconds,
  );

  return { propagationTimeline: timeline, impactedNodes, cascadeNodes };
}

export const buildGraphScenarioPropagation = buildSimulationPropagation;

function seedInitialFailures(
  initNodes: string[],
  input: { graph: GraphInstance; scenarioType: string },
  stateByNodeId: Map<string, NodePropagationState>,
  timeline: SimulationPropagationEvent[],
  depByDep: Map<string, NormalizedDependencyEdge[]>,
  attempts: PropagationAttempt[],
): void {
  for (const nodeId of initNodes) {
    const node = input.graph.getNodeAttributes(nodeId) as unknown as InfraNodeAttrs;
    stateByNodeId.set(nodeId, {
      currentStatus: 'down',
      unavailableDependencies: new Set(),
      earliestImpactSeconds: 0,
      latestEventSeconds: 0,
      cascadeDepth: 0,
      parentNodeId: null,
      rawEdgeType: null,
      propagationEdgeType: null,
      cascadeReason: describeInitialFailure(node),
    });
    timeline.push({
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
    for (const rel of depByDep.get(nodeId) ?? []) {
      const delay = calculatePropagationDelay(
        rel.propagationEdgeType,
        `${input.scenarioType}:${nodeId}:${rel.dependentId}:${rel.rawEdgeType}`,
      );
      pushSorted(attempts, {
        dependencyId: nodeId,
        dependentId: rel.dependentId,
        rawEdgeType: rel.rawEdgeType,
        propagationEdgeType: rel.propagationEdgeType,
        delaySeconds: delay,
        depth: 1,
      });
    }
  }
}

function propagateFailures(
  attempts: PropagationAttempt[],
  input: { graph: GraphInstance; scenarioType: string },
  stateByNodeId: Map<string, NodePropagationState>,
  depIds: Map<string, Set<string>>,
  depByDep: Map<string, NormalizedDependencyEdge[]>,
  timeline: SimulationPropagationEvent[],
): void {
  while (attempts.length > 0) {
    const attempt = attempts.shift()!;
    if (!input.graph.hasNode(attempt.dependentId) || !input.graph.hasNode(attempt.dependencyId))
      continue;
    const prev = stateByNodeId.get(attempt.dependentId) ?? {
      currentStatus: 'healthy' as const,
      unavailableDependencies: new Set<string>(),
      earliestImpactSeconds: Number.POSITIVE_INFINITY,
      latestEventSeconds: 0,
      cascadeDepth: attempt.depth,
      parentNodeId: attempt.dependencyId,
      rawEdgeType: attempt.rawEdgeType,
      propagationEdgeType: attempt.propagationEdgeType,
      cascadeReason: '',
    };
    if (prev.unavailableDependencies.has(attempt.dependencyId)) continue;
    prev.unavailableDependencies.add(attempt.dependencyId);
    const totalDeps = Math.max(
      depIds.get(attempt.dependentId)?.size ?? 0,
      prev.unavailableDependencies.size,
    );
    const unavail = prev.unavailableDependencies.size;
    const next: 'down' | 'degraded' = unavail >= totalDeps ? 'down' : 'degraded';
    if (
      prev.currentStatus === 'down' ||
      (prev.currentStatus === 'degraded' && next === 'degraded')
    ) {
      stateByNodeId.set(attempt.dependentId, prev);
      continue;
    }
    const depNode = input.graph.getNodeAttributes(
      attempt.dependencyId,
    ) as unknown as InfraNodeAttrs;
    const deptNode = input.graph.getNodeAttributes(
      attempt.dependentId,
    ) as unknown as InfraNodeAttrs;
    const impactType: SimulationPropagationEvent['impactType'] =
      next === 'degraded' ? 'degraded' : attempt.depth <= 1 ? 'direct_cascade' : 'indirect_cascade';
    stateByNodeId.set(attempt.dependentId, {
      currentStatus: next,
      unavailableDependencies: prev.unavailableDependencies,
      earliestImpactSeconds: Math.min(prev.earliestImpactSeconds, attempt.delaySeconds),
      latestEventSeconds: attempt.delaySeconds,
      cascadeDepth: Math.min(prev.cascadeDepth, attempt.depth),
      parentNodeId: attempt.dependencyId,
      rawEdgeType: attempt.rawEdgeType,
      propagationEdgeType: attempt.propagationEdgeType,
      cascadeReason:
        next === 'down'
          ? `${unavail}/${totalDeps} dependances indisponibles`
          : `${unavail}/${totalDeps} dependances indisponibles (service degrade)`,
    });
    timeline.push({
      timestampMinutes: toMinutes(attempt.delaySeconds),
      delaySeconds: roundSeconds(attempt.delaySeconds),
      nodeId: attempt.dependentId,
      nodeName: deptNode.name,
      nodeType: deptNode.type,
      impactType,
      impactSeverity: toImpactSeverity(impactType),
      edgeType: attempt.propagationEdgeType,
      parentNodeId: attempt.dependencyId,
      parentNodeName: depNode.name,
      description: describePropagation({
        dependencyNode: depNode,
        dependentNode: deptNode,
        propagationEdgeType: attempt.propagationEdgeType,
        delaySeconds: attempt.delaySeconds,
        impactType,
      }),
    });
    if (next !== 'down') continue;
    for (const rel of depByDep.get(attempt.dependentId) ?? []) {
      const addDelay = calculatePropagationDelay(
        rel.propagationEdgeType,
        `${input.scenarioType}:${attempt.dependentId}:${rel.dependentId}:${rel.rawEdgeType}`,
      );
      pushSorted(attempts, {
        dependencyId: attempt.dependentId,
        dependentId: rel.dependentId,
        rawEdgeType: rel.rawEdgeType,
        propagationEdgeType: rel.propagationEdgeType,
        delaySeconds: attempt.delaySeconds + addDelay,
        depth: attempt.depth + 1,
      });
    }
  }
}

function buildCascadeNodes(
  stateByNodeId: Map<string, NodePropagationState>,
  initNodes: string[],
  graph: GraphInstance,
): CascadeNode[] {
  return Array.from(stateByNodeId.entries())
    .filter(([nodeId]) => !initNodes.includes(nodeId))
    .map(([nodeId, state]) => {
      const node = graph.getNodeAttributes(nodeId) as unknown as InfraNodeAttrs;
      return {
        id: nodeId,
        name: node.name,
        type: node.type,
        status: (state.currentStatus === 'healthy' ? 'degraded' : state.currentStatus) as
          | 'down'
          | 'degraded',
        cascadeReason: state.cascadeReason || 'Propagation en cascade',
        cascadeDepth: Math.max(1, state.cascadeDepth),
      };
    })
    .sort((a, b) => a.cascadeDepth - b.cascadeDepth || a.name.localeCompare(b.name));
}

function buildImpactedNodes(
  stateByNodeId: Map<string, NodePropagationState>,
  graph: GraphInstance,
  biMap: Map<string, SimulationBusinessImpact>,
): WarRoomData['impactedNodes'] {
  return Array.from(stateByNodeId.entries())
    .map(([nodeId, state]) => {
      const node = graph.getNodeAttributes(nodeId) as unknown as InfraNodeAttrs;
      const biz = biMap.get(nodeId);
      const recovery = Math.max(
        1,
        Math.round(
          biz?.estimatedRTO ??
            node.validatedRTO ??
            node.suggestedRTO ??
            (state.currentStatus === 'down' ? 60 : 20),
        ),
      );
      return {
        id: nodeId,
        name: node.name,
        type: node.type,
        status: state.currentStatus as 'healthy' | 'degraded' | 'down',
        impactedAt: toMinutes(state.earliestImpactSeconds),
        impactedAtSeconds: roundSeconds(state.earliestImpactSeconds),
        estimatedRecovery: recovery,
      };
    })
    .sort((a, b) => a.impactedAtSeconds - b.impactedAtSeconds || a.name.localeCompare(b.name));
}
