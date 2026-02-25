// ============================================================
// GraphAnalysisEngine — SPOF detection, criticality, redundancy
// ============================================================

import type {
  InfraNodeAttrs,
  InfraEdgeAttrs,
  GraphAnalysisReport,
  SPOFReport,
  RedundancyIssue,
  RedundancyCheck,
  RegionalRisk,
  CircularDependency,
  CascadeChain,
} from './types.js';
import { NodeType, EdgeType } from './types.js';
import type { GraphInstance } from './graphService.js';
import { getBlastRadius } from './graphService.js';
import { isAnalyzableServiceNode } from './serviceClassification.js';
import { resolveServiceResolution } from '../services/dr-recommendation-engine/recommendationEngine.js';
import type { CloudServiceResolution } from '../services/dr-recommendation-engine/recommendationEngine.js';

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getMetadata(node: InfraNodeAttrs): Record<string, unknown> {
  return node.metadata && typeof node.metadata === 'object'
    ? (node.metadata as Record<string, unknown>)
    : {};
}

function getReplicaCount(metadata: Record<string, unknown>): number {
  const replicaNames = metadata.replicaNames;
  if (Array.isArray(replicaNames) && replicaNames.length > 0) {
    return replicaNames.length;
  }

  return (
    readNumber(metadata.readReplicaCount) ??
    readNumber(metadata.readReplicas) ??
    readNumber(metadata.replicaCount) ??
    readNumber(metadata.replica_count) ??
    readNumber(metadata.replicas) ??
    readNumber(metadata.replicasPerMaster) ??
    readNumber(metadata.instanceGroupSize) ??
    0
  );
}

function isMultiAzEnabled(metadata: Record<string, unknown>): boolean {
  const availabilityType = (readString(metadata.availabilityType) || '').toUpperCase();
  const highAvailabilityMode = (readString(metadata.highAvailabilityMode) || '').toLowerCase();
  const redisTier = (readString(metadata.tier) || '').toUpperCase();
  const storageReplication = (readString(metadata.replication) || '').toUpperCase();

  const fromMetadata =
    readBoolean(metadata.multiAZ) ??
    readBoolean(metadata.multiAz) ??
    readBoolean(metadata.multi_az) ??
    readBoolean(metadata.isMultiAZ) ??
    readBoolean(metadata.zoneRedundant) ??
    readBoolean(metadata.zone_redundant);

  if (fromMetadata === true) return true;
  if (availabilityType === 'REGIONAL') return true;
  if (highAvailabilityMode.length > 0 && !highAvailabilityMode.includes('disable')) return true;
  if (redisTier === 'STANDARD_HA') return true;
  if (storageReplication.includes('ZRS') || storageReplication.includes('GRS')) return true;
  return false;
}

function getAvailabilityZone(node: InfraNodeAttrs): string | null {
  if (typeof node.availabilityZone === 'string' && node.availabilityZone.trim().length > 0) {
    return node.availabilityZone.trim();
  }
  const metadata = getMetadata(node);
  const direct = readString(metadata.availabilityZone) ?? readString(metadata.zone);
  if (direct) return direct;
  if (Array.isArray(metadata.availabilityZones) && metadata.availabilityZones.length > 0) {
    const first = readString(metadata.availabilityZones[0]);
    if (first) return first;
  }
  return null;
}

function severityFromBlastRadius(blastRadius: number, totalNodes: number): 'critical' | 'high' | 'medium' | 'low' {
  const ratio = totalNodes > 0 ? blastRadius / totalNodes : 0;
  if (ratio > 0.5) return 'critical';
  if (ratio > 0.2) return 'high';
  if (blastRadius > 5) return 'medium';
  return 'low';
}

const severityOrder: Record<'critical' | 'high' | 'medium' | 'low', number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function upsertSpof(target: SPOFReport[], candidate: SPOFReport): void {
  const index = target.findIndex((entry) => entry.nodeId === candidate.nodeId);
  if (index < 0) {
    target.push(candidate);
    return;
  }

  const existing = target[index]!;
  const mergedImpacted = Array.from(new Set([...existing.impactedServices, ...candidate.impactedServices]));
  const stronger =
    severityOrder[candidate.severity] > severityOrder[existing.severity] ||
    candidate.blastRadius > existing.blastRadius;

  target[index] = stronger
    ? {
        ...candidate,
        impactedServices: mergedImpacted,
      }
    : {
        ...existing,
        impactedServices: mergedImpacted,
      };
}

function resolveNodeServiceResolution(node: InfraNodeAttrs): CloudServiceResolution {
  const metadata = getMetadata(node);
  return resolveServiceResolution({
    provider: node.provider,
    nodeType: node.type,
    metadata,
  });
}

function isManagedNoSqlSpofExempt(node: InfraNodeAttrs): boolean {
  const resolution = resolveNodeServiceResolution(node);
  return (
    resolution.kind === 'dynamodb' ||
    resolution.kind === 'firestore' ||
    resolution.kind === 'cosmosdb'
  );
}

function isS3LikeObjectStorage(node: InfraNodeAttrs): boolean {
  if (node.type !== NodeType.OBJECT_STORAGE) return false;
  const resolution = resolveNodeServiceResolution(node);
  return (
    resolution.kind === 's3' ||
    resolution.kind === 'storageAccount' ||
    resolution.kind === 'cloudStorage'
  );
}

function isManagedQueue(node: InfraNodeAttrs): boolean {
  if (node.type !== NodeType.MESSAGE_QUEUE) return false;
  const resolution = resolveNodeServiceResolution(node);
  return (
    resolution.kind === 'sqs' ||
    resolution.kind === 'sns' ||
    resolution.kind === 'serviceBus' ||
    resolution.kind === 'eventGrid' ||
    resolution.kind === 'pubsub' ||
    resolution.kind === 'cloudTasks'
  );
}

function isSqsLikeQueue(node: InfraNodeAttrs): boolean {
  if (node.type !== NodeType.MESSAGE_QUEUE) return false;
  const resolution = resolveNodeServiceResolution(node);
  return resolution.kind === 'sqs';
}

function hasDeadLetterQueue(metadata: Record<string, unknown>): boolean {
  const directArn =
    readString(metadata.deadLetterTargetArn) ??
    readString(metadata.deadLetterQueueArn) ??
    readString(metadata.dlqArn) ??
    readString(metadata.dlq);
  if (directArn) return true;

  const redrivePolicy = metadata.redrivePolicy;
  if (typeof redrivePolicy === 'string') {
    const trimmed = redrivePolicy.trim();
    return trimmed.length > 0 && trimmed !== '{}';
  }
  if (redrivePolicy && typeof redrivePolicy === 'object' && !Array.isArray(redrivePolicy)) {
    return Object.keys(redrivePolicy as Record<string, unknown>).length > 0;
  }

  return false;
}

function isManagedServiceSpofExempt(node: InfraNodeAttrs): boolean {
  if (node.type === NodeType.SERVERLESS) return true;
  if (node.type === NodeType.DATABASE && isManagedNoSqlSpofExempt(node)) return true;
  if (isS3LikeObjectStorage(node)) return true;
  if (isManagedQueue(node)) return true;
  return false;
}

// =====================================================
//  MAIN ANALYSIS
// =====================================================

export async function analyzeFullGraph(graph: GraphInstance): Promise<GraphAnalysisReport> {
  const spofs = detectSPOFs(graph);
  const criticalityScores = computeCriticality(graph);
  const redundancyIssues = analyzeRedundancy(graph);
  const regionalRisks = analyzeRegionalConcentration(graph, criticalityScores);
  const circularDeps = detectCircularDependencies(graph);
  const cascadeChains = analyzeCascadeChains(graph);

  const report: GraphAnalysisReport = {
    timestamp: new Date(),
    totalNodes: graph.order,
    totalEdges: graph.size,
    spofs,
    criticalityScores,
    redundancyIssues,
    regionalRisks,
    circularDeps,
    cascadeChains,
    resilienceScore: 0,
  };

  report.resilienceScore = computeOverallResilience(report);

  // Persist scores on nodes
  graph.forEachNode((nodeId: string) => {
    const score = criticalityScores.get(nodeId) || 0;
    graph.setNodeAttribute(nodeId, 'criticalityScore', score);
    graph.setNodeAttribute(nodeId, 'isSPOF', spofs.some(s => s.nodeId === nodeId));
    graph.setNodeAttribute(nodeId, 'dependentsCount', graph.inDegree(nodeId));
    graph.setNodeAttribute(nodeId, 'dependenciesCount', graph.outDegree(nodeId));
  });

  // Set blast radius on each node
  graph.forEachNode((nodeId: string) => {
    const blast = getBlastRadius(graph, nodeId);
    graph.setNodeAttribute(nodeId, 'blastRadius', blast.length);
  });

  return report;
}

// =====================================================
//  SPOF DETECTION (Tarjan's articulation points)
// =====================================================

function detectSPOFs(graph: GraphInstance): SPOFReport[] {
  const spofs: SPOFReport[] = [];

  if (graph.order === 0) return spofs;

  // Find articulation points
  const articulationPoints = findArticulationPoints(graph);

  // For each articulation point, compute blast radius
  for (const nodeId of articulationPoints) {
    const blast = getBlastRadius(graph, nodeId);
    const attrs = graph.getNodeAttributes(nodeId) as InfraNodeAttrs;
    if (!isAnalyzableServiceNode(attrs)) continue;
    if (isManagedServiceSpofExempt(attrs)) continue;

    upsertSpof(spofs, {
      nodeId,
      nodeName: attrs.name,
      nodeType: attrs.type,
      severity: severityFromBlastRadius(blast.length, graph.order),
      blastRadius: blast.length,
      impactedServices: blast.map(n => n.name),
      recommendation: generateSPOFRecommendation(attrs, blast.length),
    });
  }

  // Also check high fan-in nodes that aren't articulation points
  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    if (!isAnalyzableServiceNode(a)) return;
    if (isManagedServiceSpofExempt(a)) return;

    const inDeg = graph.inDegree(nodeId);
    if (inDeg > 10 && !articulationPoints.has(nodeId)) {
      upsertSpof(spofs, {
        nodeId,
        nodeName: a.name,
        nodeType: a.type,
        severity: 'medium',
        blastRadius: inDeg,
        impactedServices: graph.inNeighbors(nodeId).map(
          (id: string) => (graph.getNodeAttributes(id) as InfraNodeAttrs).name
        ),
        recommendation: `${a.name} has ${inDeg} direct dependents. Consider adding a load balancer or replication.`,
      });
    }
  });

  for (const explicitSpof of detectExplicitServiceSpofs(graph)) {
    upsertSpof(spofs, explicitSpof);
  }

  return spofs.sort((a, b) => b.blastRadius - a.blastRadius);
}

function isVmServiceNode(node: InfraNodeAttrs): boolean {
  if (node.type !== NodeType.VM) return false;
  if (!isAnalyzableServiceNode(node)) return false;

  const metadata = getMetadata(node);
  const sourceType = (readString(metadata.sourceType) || '').toLowerCase();

  if (
    sourceType.includes('asg') ||
    sourceType.includes('auto_scaling') ||
    sourceType.includes('vmss') ||
    sourceType.includes('virtualmachinescaleset') ||
    sourceType.includes('managedinstancegroup') ||
    sourceType.includes('instancegroupmanager')
  ) {
    return false;
  }
  if (sourceType.includes('security_group') || sourceType.includes('route_table')) return false;
  if (sourceType.includes('internet_gateway') || sourceType.includes('nat_gateway')) return false;

  return true;
}

function hasElasticScaling(node: InfraNodeAttrs): boolean {
  const metadata = getMetadata(node);
  const explicitGroup =
    readString(metadata.autoScalingGroupName) ??
    readString(metadata.asgName) ??
    readString(metadata.autoScalingGroup) ??
    readString(metadata.vmssId) ??
    readString(metadata.virtualMachineScaleSetId) ??
    readString(metadata.instanceGroupManager) ??
    readString(metadata.managedInstanceGroup);
  if (explicitGroup) return true;

  const sourceType = (readString(metadata.sourceType) || '').toLowerCase();
  if (
    sourceType.includes('asg') ||
    sourceType.includes('auto_scaling') ||
    sourceType.includes('vmss') ||
    sourceType.includes('virtualmachinescaleset') ||
    sourceType.includes('managedinstancegroup') ||
    sourceType.includes('instancegroupmanager')
  ) {
    return true;
  }

  const instanceGroupSize = readNumber(metadata.instanceGroupSize) ?? 0;
  const vmssInstanceCount = readNumber(metadata.vmssInstanceCount) ?? 0;
  return instanceGroupSize > 1 || vmssInstanceCount > 1;
}

function detectExplicitServiceSpofs(graph: GraphInstance): SPOFReport[] {
  const spofs: SPOFReport[] = [];

  const vmNodes: InfraNodeAttrs[] = [];
  graph.forEachNode((_nodeId: string, attrs: any) => {
    const node = attrs as InfraNodeAttrs;
    if (isVmServiceNode(node)) vmNodes.push(node);
  });

  const vmAzValues = vmNodes
    .map((node) => getAvailabilityZone(node))
    .filter((az): az is string => Boolean(az));
  const vmAzSet = new Set(vmAzValues);
  const vmSameAzRisk = vmNodes.length > 1 && vmAzSet.size === 1;

  for (const node of vmNodes) {
    if (hasElasticScaling(node)) continue;

    const isSingleInstance = vmNodes.length === 1;
    if (!isSingleInstance && !vmSameAzRisk) continue;

    const blast = getBlastRadius(graph, node.id);
    const recommendation = isSingleInstance
      ? `Deploy at least one additional instance for ${node.name} in another availability zone and front it with a load balancer.`
      : `Distribute ${node.name} workload across multiple availability zones to remove single-AZ dependency.`;

    spofs.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      severity: blast.length >= 3 ? 'critical' : 'high',
      blastRadius: blast.length,
      impactedServices: blast.map((item) => item.name),
      recommendation,
    });
  }

  graph.forEachNode((nodeId: string, attrs: any) => {
    const node = attrs as InfraNodeAttrs;
    if (!isAnalyzableServiceNode(node)) return;

    const metadata = getMetadata(node);
    const resolution = resolveNodeServiceResolution(node);

    if (node.type === NodeType.DATABASE) {
      if (isManagedNoSqlSpofExempt(node)) return;

      const availabilityType = (readString(metadata.availabilityType) || '').toUpperCase();
      const highAvailabilityMode = (readString(metadata.highAvailabilityMode) || '').toLowerCase();
      const hasGeoReplication =
        (Array.isArray(metadata.geoReplicationLinks) && metadata.geoReplicationLinks.length > 0) ||
        Boolean(readString(metadata.failoverGroupId));
      const flexibleHaEnabled = highAvailabilityMode.length > 0 && !highAvailabilityMode.includes('disable');
      const multiAz = isMultiAzEnabled(metadata);
      const hasReplica = getReplicaCount(metadata) > 0;

      const isBigtable = resolution.kind === 'bigTable';
      const bigtableClusterCount =
        readNumber(metadata.clusterCount) ?? readNumber(metadata.clustersCount) ?? 1;
      const bigtableSingleCluster = isBigtable && bigtableClusterCount <= 1;

      const hasDatabaseHa =
        multiAz ||
        hasReplica ||
        availabilityType === 'REGIONAL' ||
        flexibleHaEnabled ||
        hasGeoReplication;

      if (bigtableSingleCluster || !hasDatabaseHa) {
        const recommendation = bigtableSingleCluster
          ? `Add a replicated Bigtable cluster in another zone/region for ${node.name}.`
          : `Enable high availability or replication for ${node.name} (multi-zone or synchronous standby).`;
        const blast = getBlastRadius(graph, nodeId);
        spofs.push({
          nodeId,
          nodeName: node.name,
          nodeType: node.type,
          severity: blast.length >= 3 ? 'critical' : 'high',
          blastRadius: blast.length,
          impactedServices: blast.map((item) => item.name),
          recommendation,
        });
      }
      return;
    }

    if (node.type === NodeType.CACHE) {
      const tier = (
        readString(metadata.tier) ??
        readString(metadata.sku_name) ??
        readString(metadata.skuName) ??
        readString(metadata.sku) ??
        ''
      ).toUpperCase();
      const numCacheNodes =
        readNumber(metadata.numCacheNodes) ??
        readNumber(metadata.num_cache_nodes) ??
        readNumber(metadata.cacheNodes);
      const replicaCount = getReplicaCount(metadata);
      const replicationGroupId = readString(metadata.replicationGroupId) ?? readString(metadata.replicationGroup);
      const hasTierReplication =
        tier.includes('STANDARD') || tier.includes('PREMIUM') || tier.includes('STANDARD_HA');
      const singleNode = numCacheNodes != null ? numCacheNodes <= 1 : (!hasTierReplication && replicaCount <= 0);
      const missingReplication = !hasTierReplication && !replicationGroupId && replicaCount <= 0;
      const basicTier = tier.includes('BASIC');

      if (singleNode || missingReplication || basicTier) {
        const recommendation = basicTier
          ? `Migrate ${node.name} from Basic to a replicated cache tier (Standard/Premium or STANDARD_HA).`
          : `Enable replication group / cluster mode for ${node.name} with at least 2 cache nodes.`;
        const blast = getBlastRadius(graph, nodeId);
        spofs.push({
          nodeId,
          nodeName: node.name,
          nodeType: node.type,
          severity: blast.length >= 3 ? 'critical' : 'high',
          blastRadius: blast.length,
          impactedServices: blast.map((item) => item.name),
          recommendation,
        });
      }
    }
  });

  return spofs;
}

function findArticulationPoints(graph: GraphInstance): Set<string> {
  const visited = new Set<string>();
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const ap = new Set<string>();
  let time = 0;

  const dfs = (u: string) => {
    let children = 0;
    visited.add(u);
    disc.set(u, time);
    low.set(u, time);
    time++;

    // Treat as undirected for articulation point detection
    const neighbors = new Set([...graph.outNeighbors(u), ...graph.inNeighbors(u)]);

    for (const v of neighbors) {
      if (!visited.has(v)) {
        children++;
        parent.set(v, u);
        dfs(v);

        low.set(u, Math.min(low.get(u)!, low.get(v)!));

        // Root with 2+ children
        if (parent.get(u) === null && children > 1) {
          ap.add(u);
        }
        // Non-root with low[v] >= disc[u]
        if (parent.get(u) !== null && low.get(v)! >= disc.get(u)!) {
          ap.add(u);
        }
      } else if (v !== parent.get(u)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  };

  graph.forEachNode((nodeId: string) => {
    if (!visited.has(nodeId)) {
      parent.set(nodeId, null);
      dfs(nodeId);
    }
  });

  return ap;
}

function generateSPOFRecommendation(node: InfraNodeAttrs, blastRadius: number): string {
  const type = node.type;
  if (type === NodeType.DATABASE) {
    return `Add read replicas and enable Multi-AZ for ${node.name} to eliminate this SPOF (blast radius: ${blastRadius} services).`;
  }
  if (type === NodeType.LOAD_BALANCER || type === NodeType.API_GATEWAY) {
    return `Deploy ${node.name} across multiple availability zones (blast radius: ${blastRadius} services).`;
  }
  if (type === NodeType.DNS) {
    return `Configure DNS failover with a secondary provider for ${node.name} (blast radius: ${blastRadius} services).`;
  }
  if (type === NodeType.CACHE) {
    return `Enable replication and cluster mode for ${node.name} (blast radius: ${blastRadius} services).`;
  }
  return `${node.name} (${type}) is a single point of failure affecting ${blastRadius} services. Add redundancy.`;
}

// =====================================================
//  CRITICALITY SCORING
// =====================================================

function computeCriticality(graph: GraphInstance): Map<string, number> {
  const scores = new Map<string, number>();

  if (graph.order === 0) return scores;

  // Simple betweenness approximation using BFS from each node
  const betweenness = computeSimpleBetweenness(graph);
  const maxBetweenness = Math.max(...Array.from(betweenness.values()), 1);

  let maxFanIn = 1;
  graph.forEachNode((nodeId: string) => {
    maxFanIn = Math.max(maxFanIn, graph.inDegree(nodeId));
  });

  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    const bc = ((betweenness.get(nodeId) || 0) / maxBetweenness) * 40;
    const fanIn = graph.inDegree(nodeId);
    const fanInScore = (fanIn / maxFanIn) * 25;
    const typeScore = getTypeWeight(a.type) * 20;
    const redundancy = getNodeRedundancyScore(nodeId, graph);
    const redundancyPenalty = (1 - redundancy / 100) * 15;

    scores.set(nodeId, Math.round(bc + fanInScore + typeScore + redundancyPenalty));
  });

  return scores;
}

function computeSimpleBetweenness(graph: GraphInstance): Map<string, number> {
  const betweenness = new Map<string, number>();
  graph.forEachNode((nodeId: string) => betweenness.set(nodeId, 0));

  // Sample nodes for large graphs
  const allNodes = graph.nodes();
  const sampleSize = Math.min(allNodes.length, 100);
  const sampledNodes = allNodes.slice(0, sampleSize);

  for (const source of sampledNodes) {
    // BFS
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
          paths.set(neighbor, (paths.get(neighbor) || 0) + (paths.get(current) || 0));
        }
      }
    }

    // Accumulate
    const delta = new Map<string, number>();
    graph.forEachNode((nodeId: string) => delta.set(nodeId, 0));

    while (order.length > 0) {
      const w = order.pop()!;
      if (w === source) continue;
      const neighbors = new Set([...graph.outNeighbors(w), ...graph.inNeighbors(w)]);
      for (const v of neighbors) {
        if (dist.get(v) === dist.get(w)! - 1) {
          const contribution = ((paths.get(v) || 0) / (paths.get(w) || 1)) * (1 + (delta.get(w) || 0));
          delta.set(v, (delta.get(v) || 0) + contribution);
        }
      }
      betweenness.set(w, (betweenness.get(w) || 0) + (delta.get(w) || 0));
    }
  }

  return betweenness;
}

function getTypeWeight(type: string): number {
  const weights: Record<string, number> = {
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
  return weights[type] || 0.5;
}

function getNodeRedundancyScore(nodeId: string, graph: GraphInstance): number {
  const attrs = graph.getNodeAttributes(nodeId) as InfraNodeAttrs;
  const metadata = getMetadata(attrs);
  let score = 100;

  // No Multi-AZ for DB/Cache
  if ([NodeType.DATABASE, NodeType.CACHE].includes(attrs.type as NodeType)) {
    const isManagedNoSql = attrs.type === NodeType.DATABASE && isManagedNoSqlSpofExempt(attrs);
    if (!isManagedNoSql) {
      if (!isMultiAzEnabled(metadata)) score -= 25;
      if (getReplicaCount(metadata) === 0) score -= 25;
    }
  }

  // No load balancer in front
  if ([NodeType.VM, NodeType.CONTAINER, NodeType.APPLICATION, NodeType.MICROSERVICE].includes(attrs.type as NodeType)) {
    const hasLB = graph.inNeighbors(nodeId).some((id: string) => {
      const n = graph.getNodeAttributes(id) as InfraNodeAttrs;
      return n.type === NodeType.LOAD_BALANCER;
    });
    if (!hasLB) score -= 25;
  }

  if (isVmServiceNode(attrs)) {
    const vmNodes: InfraNodeAttrs[] = [];
    graph.forEachNode((_id: string, nodeAttrs: any) => {
      const vmNode = nodeAttrs as InfraNodeAttrs;
      if (isVmServiceNode(vmNode) && !hasElasticScaling(vmNode)) {
        vmNodes.push(vmNode);
      }
    });

    const vmAzSet = new Set(
      vmNodes
        .map((node) => getAvailabilityZone(node))
        .filter((az): az is string => Boolean(az))
    );
    if (vmNodes.length === 1) score -= 25;
    else if (vmNodes.length > 1 && vmAzSet.size === 1) score -= 20;
  }

  // Check backup edges
  const hasBackup = graph.outEdges(nodeId).some((edgeKey: string) => {
    const edgeAttrs = graph.getEdgeAttributes(edgeKey) as InfraEdgeAttrs;
    return edgeAttrs.type === EdgeType.BACKS_UP_TO;
  });
  const shouldCheckBackup =
    attrs.type === NodeType.DATABASE ||
    (attrs.type === NodeType.OBJECT_STORAGE && !isS3LikeObjectStorage(attrs));
  if (!hasBackup && shouldCheckBackup) {
    score -= 25;
  }

  return Math.max(0, score);
}

// =====================================================
//  REDUNDANCY ANALYSIS
// =====================================================

function analyzeRedundancy(graph: GraphInstance): RedundancyIssue[] {
  const issues: RedundancyIssue[] = [];
  const vmNodes: InfraNodeAttrs[] = [];

  graph.forEachNode((_nodeId: string, attrs: any) => {
    const node = attrs as InfraNodeAttrs;
    if (isVmServiceNode(node) && !hasElasticScaling(node)) {
      vmNodes.push(node);
    }
  });
  const vmAzSet = new Set(
    vmNodes
      .map((node) => getAvailabilityZone(node))
      .filter((az): az is string => Boolean(az))
  );
  const vmSingleInstance = vmNodes.length === 1;
  const vmSingleAzDistribution = vmNodes.length > 1 && vmAzSet.size === 1;

  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    if (!isAnalyzableServiceNode(a)) return;

    const metadata = getMetadata(a);
    const checks: RedundancyCheck[] = [];
    const isManagedNoSql = a.type === NodeType.DATABASE && isManagedNoSqlSpofExempt(a);

    // Multi-AZ check
    if (
      !isManagedNoSql &&
      [NodeType.DATABASE, NodeType.CACHE].includes(a.type as NodeType) &&
      !isMultiAzEnabled(metadata)
    ) {
      checks.push({
        check: 'multi_az',
        passed: false,
        recommendation: `Enable Multi-AZ for ${a.name}`,
        impact: 'high',
      });
    }

    // Read replicas
    if (!isManagedNoSql && a.type === NodeType.DATABASE && getReplicaCount(metadata) === 0) {
      checks.push({
        check: 'read_replicas',
        passed: false,
        recommendation: `Add at least one read replica for ${a.name}`,
        impact: 'high',
      });
    }

    // Cache replication
    if (a.type === NodeType.CACHE) {
      const tier = (
        readString(metadata.tier) ??
        readString(metadata.sku_name) ??
        readString(metadata.skuName) ??
        readString(metadata.sku) ??
        ''
      ).toUpperCase();
      const numCacheNodes =
        readNumber(metadata.numCacheNodes) ??
        readNumber(metadata.num_cache_nodes) ??
        readNumber(metadata.cacheNodes);
      const replicaCount = getReplicaCount(metadata);
      const replicationGroupId = readString(metadata.replicationGroupId) ?? readString(metadata.replicationGroup);
      const hasTierReplication =
        tier.includes('STANDARD') || tier.includes('PREMIUM') || tier.includes('STANDARD_HA');
      const singleNode = numCacheNodes != null ? numCacheNodes <= 1 : (!hasTierReplication && replicaCount <= 0);
      const missingReplication = !hasTierReplication && !replicationGroupId && replicaCount <= 0;
      const basicTier = tier.includes('BASIC');
      if (singleNode || missingReplication || basicTier) {
        checks.push({
          check: 'cache_replication',
          passed: false,
          recommendation: `Enable replication group / cluster mode for ${a.name}`,
          impact: 'high',
        });
      }
    }

    // Load balancer
    if ([NodeType.VM, NodeType.CONTAINER].includes(a.type as NodeType)) {
      const hasLB = graph.inNeighbors(nodeId).some(
        (id: string) => (graph.getNodeAttributes(id) as InfraNodeAttrs).type === NodeType.LOAD_BALANCER
      );
      if (!hasLB) {
        checks.push({
          check: 'load_balancer',
          passed: false,
          recommendation: `${a.name} is not behind a load balancer`,
          impact: 'medium',
        });
      }
    }

    // EC2 distribution checks
    if (isVmServiceNode(a) && !hasElasticScaling(a)) {
      if (vmSingleInstance) {
        checks.push({
          check: 'single_instance',
          passed: false,
          recommendation: `${a.name} is a single compute instance without elastic group scaling`,
          impact: 'critical',
        });
      } else if (vmSingleAzDistribution) {
        checks.push({
          check: 'single_az_distribution',
          passed: false,
          recommendation: `${a.name} fleet is concentrated in one availability zone`,
          impact: 'high',
        });
      }
    }

    // Single region concentration for dependents
    const dependents = graph.inNeighbors(nodeId);
    if (dependents.length > 3) {
      const regions = new Set(
        dependents
          .map(id => (graph.getNodeAttributes(id) as InfraNodeAttrs).region)
          .filter(Boolean)
      );
      if (regions.size === 1) {
        checks.push({
          check: 'single_region',
          passed: false,
          recommendation: `${a.name} and its ${dependents.length} dependents are all in region ${[...regions][0]}`,
          impact: 'high',
        });
      }
    }

    // Managed queue reliability warning (not a SPOF by itself)
    if (isSqsLikeQueue(a) && !hasDeadLetterQueue(metadata)) {
      checks.push({
        check: 'dlq',
        passed: false,
        recommendation: `Configure a dead-letter queue for ${a.name}`,
        impact: 'low',
      });
    }

    // Backup check
    const hasBackup = graph.outEdges(nodeId).some(edgeKey => {
      return (graph.getEdgeAttributes(edgeKey) as InfraEdgeAttrs).type === EdgeType.BACKS_UP_TO;
    });
    const shouldCheckBackup =
      (!isManagedNoSql && a.type === NodeType.DATABASE) ||
      (a.type === NodeType.OBJECT_STORAGE && !isS3LikeObjectStorage(a));
    if (
      !hasBackup &&
      shouldCheckBackup
    ) {
      checks.push({
        check: 'backup',
        passed: false,
        recommendation: `No backup detected for ${a.name}`,
        impact: 'critical',
      });
    }

    const failedChecks = checks.filter(c => !c.passed);
    if (failedChecks.length > 0) {
      issues.push({
        nodeId,
        nodeName: a.name,
        nodeType: a.type,
        redundancyScore: Math.max(0, 100 - failedChecks.length * 25),
        failedChecks,
      });
    }
  });

  return issues;
}

// =====================================================
//  REGIONAL CONCENTRATION
// =====================================================

function analyzeRegionalConcentration(graph: GraphInstance, criticalityScores: Map<string, number>): RegionalRisk[] {
  const regionMap = new Map<string, { total: number; critical: number; nodes: string[] }>();

  graph.forEachNode((nodeId: string, attrs: any) => {
    const a = attrs as InfraNodeAttrs;
    if (!a.region) return;
    if (!regionMap.has(a.region)) {
      regionMap.set(a.region, { total: 0, critical: 0, nodes: [] });
    }
    const entry = regionMap.get(a.region)!;
    entry.total++;
    entry.nodes.push(a.name);
    if ((criticalityScores.get(nodeId) || 0) > 70) {
      entry.critical++;
    }
  });

  const risks: RegionalRisk[] = [];
  const totalNodes = graph.order;
  if (totalNodes === 0) return risks;

  for (const [region, data] of regionMap) {
    const concentration = data.total / totalNodes;
    if (concentration > 0.7) {
      risks.push({
        region,
        concentration: Math.round(concentration * 100),
        totalNodes: data.total,
        criticalNodes: data.critical,
        risk: 'critical',
        recommendation: `${Math.round(concentration * 100)}% of infrastructure is concentrated in ${region}. Consider multi-region distribution.`,
      });
    } else if (concentration > 0.5) {
      risks.push({
        region,
        concentration: Math.round(concentration * 100),
        totalNodes: data.total,
        criticalNodes: data.critical,
        risk: 'high',
        recommendation: `High concentration in ${region}. Plan critical service distribution across regions.`,
      });
    }
  }

  return risks;
}

// =====================================================
//  CIRCULAR DEPENDENCIES
// =====================================================

function detectCircularDependencies(graph: GraphInstance): CircularDependency[] {
  const cycles: CircularDependency[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  const dfs = (nodeId: string) => {
    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);

    for (const neighbor of graph.outNeighbors(nodeId)) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (inStack.has(neighbor)) {
        // Found cycle
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart >= 0) {
          const cycleNodes = path.slice(cycleStart).map(id => ({
            id,
            name: (graph.getNodeAttributes(id) as InfraNodeAttrs).name,
          }));
          // Only add if cycle length > 1 and not already recorded
          if (cycleNodes.length > 1) {
            const key = cycleNodes.map(n => n.id).sort().join(',');
            if (!cycles.some(c => c.nodes.map(n => n.id).sort().join(',') === key)) {
              cycles.push({ nodes: cycleNodes, length: cycleNodes.length });
            }
          }
        }
      }
    }

    path.pop();
    inStack.delete(nodeId);
  };

  graph.forEachNode((nodeId: string) => {
    if (!visited.has(nodeId)) {
      dfs(nodeId);
    }
  });

  return cycles;
}

// =====================================================
//  CASCADE CHAINS
// =====================================================

function analyzeCascadeChains(graph: GraphInstance): CascadeChain[] {
  const chains: CascadeChain[] = [];

  // Analyze top nodes by in-degree (most depended upon)
  const nodesByInDegree: Array<{ id: string; inDeg: number }> = [];
  graph.forEachNode((nodeId: string) => {
    nodesByInDegree.push({ id: nodeId, inDeg: graph.inDegree(nodeId) });
  });
  nodesByInDegree.sort((a, b) => b.inDeg - a.inDeg);

  // Analyze top 20 nodes
  for (const { id } of nodesByInDegree.slice(0, 20)) {
    const blast = getBlastRadius(graph, id);
    if (blast.length > 2) {
      const attrs = graph.getNodeAttributes(id) as InfraNodeAttrs;
      chains.push({
        sourceNodeId: id,
        sourceNodeName: attrs.name,
        depth: Math.max(...blast.map(() => 1), 0), // simplified
        totalImpacted: blast.length,
        impactedNodes: blast.slice(0, 50).map((n, i) => ({
          id: n.id,
          name: n.name,
          depth: i + 1,
        })),
      });
    }
  }

  return chains.sort((a, b) => b.totalImpacted - a.totalImpacted);
}

// =====================================================
//  OVERALL RESILIENCE SCORE
// =====================================================

function computeOverallResilience(report: GraphAnalysisReport): number {
  let score = 100;

  // SPOF critiques: -10 per critical, -5 per high
  const criticalSPOFs = report.spofs.filter(s => s.severity === 'critical').length;
  const highSPOFs = report.spofs.filter(s => s.severity === 'high').length;
  score -= Math.min(30, criticalSPOFs * 10 + highSPOFs * 5);

  // Redundancy average
  if (report.redundancyIssues.length > 0) {
    const avgRedundancy = report.redundancyIssues.reduce(
      (sum, i) => sum + i.redundancyScore, 0
    ) / report.redundancyIssues.length;
    score -= Math.round((1 - avgRedundancy / 100) * 25);
  }

  // Regional concentration
  const hasCriticalRegional = report.regionalRisks.some(r => r.risk === 'critical');
  if (hasCriticalRegional) score -= 20;
  else if (report.regionalRisks.some(r => r.risk === 'high')) score -= 10;

  // Circular dependencies
  score -= Math.min(15, report.circularDeps.length * 5);

  return Math.max(0, Math.min(100, score));
}
