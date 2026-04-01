/**
 * Criticality scoring — betweenness centrality approximation,
 * type-based weights, and per-node redundancy score.
 */

import type { InfraNodeAttrs, InfraEdgeAttrs } from '../types/index.js';
import { NodeType, EdgeType } from '../types/index.js';
import type { CloudServiceResolver } from '../ports/cloud-service-resolver.js';
import type { GraphInstance } from './graph-instance.js';
import {
  getMetadata,
  isMultiAzEnabled,
  getReplicaCount,
  getAvailabilityZone,
  isManagedNoSqlSpofExempt,
  isS3LikeObjectStorage,
} from './analysis-helpers.js';
import { isVmServiceNode, hasElasticScaling } from './spof-detection.js';

const TYPE_WEIGHTS: Record<string, number> = {
  [NodeType.DATABASE]: 1.0,
  [NodeType.CACHE]: 0.9,
  [NodeType.MESSAGE_QUEUE]: 0.85,
  [NodeType.API_GATEWAY]: 0.8,
  [NodeType.LOAD_BALANCER]: 0.8,
  [NodeType.DNS]: 0.8,
  [NodeType.KUBERNETES_CLUSTER]: 0.75,
  [NodeType.VM]: 0.6,
  [NodeType.CONTAINER]: 0.5,
  [NodeType.SERVERLESS]: 0.4,
  [NodeType.OBJECT_STORAGE]: 0.3,
  [NodeType.VPC]: 0.3,
  [NodeType.SUBNET]: 0.2,
  [NodeType.CDN]: 0.4,
  [NodeType.FIREWALL]: 0.7,
  [NodeType.APPLICATION]: 0.6,
  [NodeType.MICROSERVICE]: 0.55,
  [NodeType.THIRD_PARTY_API]: 0.5,
  [NodeType.SAAS_SERVICE]: 0.45,
  [NodeType.PHYSICAL_SERVER]: 0.6,
  [NodeType.NETWORK_DEVICE]: 0.65,
  [NodeType.FILE_STORAGE]: 0.35,
  [NodeType.REGION]: 0.1,
  [NodeType.AVAILABILITY_ZONE]: 0.1,
  [NodeType.DATA_CENTER]: 0.15,
};

function getTypeWeight(type: string): number {
  return TYPE_WEIGHTS[type] ?? 0.5;
}

export function computeCriticality(
  graph: GraphInstance,
  resolver: CloudServiceResolver,
): Map<string, number> {
  const scores = new Map<string, number>();
  if (graph.order === 0) return scores;

  const betweenness = computeSimpleBetweenness(graph);
  const maxBetweenness = Math.max(...Array.from(betweenness.values()), 1);

  let maxFanIn = 1;
  graph.forEachNode((nodeId) => {
    maxFanIn = Math.max(maxFanIn, graph.inDegree(nodeId));
  });

  graph.forEachNode((nodeId, rawAttrs) => {
    const a = rawAttrs as unknown as InfraNodeAttrs;
    if (a.criticalitySource === 'manual' && typeof a.criticalityScore === 'number') {
      scores.set(nodeId, Math.max(0, Math.min(100, Math.round(a.criticalityScore))));
      return;
    }

    const bc = ((betweenness.get(nodeId) ?? 0) / maxBetweenness) * 40;
    const fanIn = graph.inDegree(nodeId);
    const fanInScore = (fanIn / maxFanIn) * 25;
    const typeScore = getTypeWeight(a.type) * 20;
    const redundancy = getNodeRedundancyScore(nodeId, graph, resolver);
    const redundancyPenalty = (1 - redundancy / 100) * 15;
    scores.set(nodeId, Math.round(bc + fanInScore + typeScore + redundancyPenalty));
  });

  return scores;
}

const MAX_BETWEENNESS_SAMPLE = 100;

function computeSimpleBetweenness(graph: GraphInstance): Map<string, number> {
  const betweenness = new Map<string, number>();
  graph.forEachNode((nodeId) => betweenness.set(nodeId, 0));

  const allNodes = graph.nodes();
  const sampledNodes = allNodes.slice(0, MAX_BETWEENNESS_SAMPLE);

  for (const source of sampledNodes) {
    const queue = [source];
    const dist = new Map<string, number>([[source, 0]]);
    const paths = new Map<string, number>([[source, 1]]);
    const order: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);
      const neighbors = new Set([...graph.outNeighbors(current), ...graph.inNeighbors(current)]);
      for (const neighbor of neighbors) {
        if (!dist.has(neighbor)) {
          dist.set(neighbor, dist.get(current)! + 1);
          paths.set(neighbor, 0);
          queue.push(neighbor);
        }
        if (dist.get(neighbor) === dist.get(current)! + 1) {
          paths.set(neighbor, (paths.get(neighbor) ?? 0) + (paths.get(current) ?? 0));
        }
      }
    }

    const delta = new Map<string, number>();
    graph.forEachNode((nodeId) => delta.set(nodeId, 0));

    while (order.length > 0) {
      const w = order.pop()!;
      if (w === source) continue;
      const neighbors = new Set([...graph.outNeighbors(w), ...graph.inNeighbors(w)]);
      for (const v of neighbors) {
        if (dist.get(v) === dist.get(w)! - 1) {
          const contribution =
            ((paths.get(v) ?? 0) / (paths.get(w) ?? 1)) * (1 + (delta.get(w) ?? 0));
          delta.set(v, (delta.get(v) ?? 0) + contribution);
        }
      }
      betweenness.set(w, (betweenness.get(w) ?? 0) + (delta.get(w) ?? 0));
    }
  }

  return betweenness;
}

export function getNodeRedundancyScore(
  nodeId: string,
  graph: GraphInstance,
  resolver: CloudServiceResolver,
): number {
  const attrs = graph.getNodeAttributes(nodeId) as unknown as InfraNodeAttrs;
  const metadata = getMetadata(attrs);
  let score = 100;

  if ([NodeType.DATABASE, NodeType.CACHE].includes(attrs.type as NodeType)) {
    const isNoSql = attrs.type === NodeType.DATABASE && isManagedNoSqlSpofExempt(attrs, resolver);
    if (!isNoSql) {
      if (!isMultiAzEnabled(metadata)) score -= 25;
      if (getReplicaCount(metadata) === 0) score -= 25;
    }
  }

  if (
    [NodeType.VM, NodeType.CONTAINER, NodeType.APPLICATION, NodeType.MICROSERVICE].includes(
      attrs.type as NodeType,
    )
  ) {
    const hasLB = graph
      .inNeighbors(nodeId)
      .some(
        (id) =>
          (graph.getNodeAttributes(id) as unknown as InfraNodeAttrs).type ===
          NodeType.LOAD_BALANCER,
      );
    if (!hasLB) score -= 25;
  }

  if (isVmServiceNode(attrs)) {
    const vmNodes: InfraNodeAttrs[] = [];
    graph.forEachNode((_id, raw) => {
      const n = raw as unknown as InfraNodeAttrs;
      if (isVmServiceNode(n) && !hasElasticScaling(n)) vmNodes.push(n);
    });
    const vmAzSet = new Set(
      vmNodes.map((n) => getAvailabilityZone(n)).filter((az): az is string => Boolean(az)),
    );
    if (vmNodes.length === 1) score -= 25;
    else if (vmNodes.length > 1 && vmAzSet.size === 1) score -= 20;
  }

  const hasBackup = graph
    .outEdges(nodeId)
    .some(
      (ek) =>
        (graph.getEdgeAttributes(ek) as unknown as InfraEdgeAttrs).type === EdgeType.BACKS_UP_TO,
    );
  const shouldCheckBackup =
    attrs.type === NodeType.DATABASE ||
    (attrs.type === NodeType.OBJECT_STORAGE && !isS3LikeObjectStorage(attrs, resolver));
  if (!hasBackup && shouldCheckBackup) score -= 25;

  return Math.max(0, score);
}
