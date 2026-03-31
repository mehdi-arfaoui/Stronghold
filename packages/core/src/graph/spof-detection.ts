/**
 * SPOF detection using Tarjan's articulation points algorithm
 * and explicit service-level checks (VM, DB, Cache).
 */

import type { InfraNodeAttrs, SPOFReport } from '../types/index.js';
import { NodeType } from '../types/index.js';
import type { CloudServiceResolver } from '../ports/cloud-service-resolver.js';
import type { GraphInstance } from './graph-instance.js';
import { getBlastRadius } from './graph-utils.js';
import { isAnalyzableServiceNode } from './service-classification.js';
import {
  getMetadata,
  readString,
  readNumber,
  isMultiAzEnabled,
  getReplicaCount,
  getAvailabilityZone,
  severityFromBlastRadius,
  upsertSpof,
  isManagedServiceSpofExempt,
  isManagedNoSqlSpofExempt,
  resolveNode,
} from './analysis-helpers.js';

function generateSPOFRecommendation(node: InfraNodeAttrs, blastRadius: number): string {
  if (node.type === NodeType.DATABASE) {
    return `Add read replicas and enable Multi-AZ for ${node.name} to eliminate this SPOF (blast radius: ${blastRadius} services).`;
  }
  if (node.type === NodeType.LOAD_BALANCER || node.type === NodeType.API_GATEWAY) {
    return `Deploy ${node.name} across multiple availability zones (blast radius: ${blastRadius} services).`;
  }
  if (node.type === NodeType.DNS) {
    return `Configure DNS failover with a secondary provider for ${node.name} (blast radius: ${blastRadius} services).`;
  }
  if (node.type === NodeType.CACHE) {
    return `Enable replication and cluster mode for ${node.name} (blast radius: ${blastRadius} services).`;
  }
  return `${node.name} (${node.type}) is a single point of failure affecting ${blastRadius} services. Add redundancy.`;
}

export function findArticulationPoints(graph: GraphInstance): Set<string> {
  const visited = new Set<string>();
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const ap = new Set<string>();
  let time = 0;

  const dfs = (u: string): void => {
    let children = 0;
    visited.add(u);
    disc.set(u, time);
    low.set(u, time);
    time++;

    const neighbors = new Set([...graph.outNeighbors(u), ...graph.inNeighbors(u)]);

    for (const v of neighbors) {
      if (!visited.has(v)) {
        children++;
        parent.set(v, u);
        dfs(v);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (parent.get(u) === null && children > 1) ap.add(u);
        if (parent.get(u) !== null && low.get(v)! >= disc.get(u)!) ap.add(u);
      } else if (v !== parent.get(u)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  };

  graph.forEachNode((nodeId) => {
    if (!visited.has(nodeId)) {
      parent.set(nodeId, null);
      dfs(nodeId);
    }
  });

  return ap;
}

export function isVmServiceNode(node: InfraNodeAttrs): boolean {
  if (node.type !== NodeType.VM) return false;
  if (!isAnalyzableServiceNode(node)) return false;
  const metadata = getMetadata(node);
  const sourceType = (readString(metadata.sourceType) || '').toLowerCase();
  const autoScalePatterns = [
    'asg',
    'auto_scaling',
    'vmss',
    'virtualmachinescaleset',
    'managedinstancegroup',
    'instancegroupmanager',
  ];
  if (autoScalePatterns.some((p) => sourceType.includes(p))) return false;
  if (sourceType.includes('security_group') || sourceType.includes('route_table')) return false;
  if (sourceType.includes('internet_gateway') || sourceType.includes('nat_gateway')) return false;
  return true;
}

export function hasElasticScaling(node: InfraNodeAttrs): boolean {
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
  const patterns = [
    'asg',
    'auto_scaling',
    'vmss',
    'virtualmachinescaleset',
    'managedinstancegroup',
    'instancegroupmanager',
  ];
  if (patterns.some((p) => sourceType.includes(p))) return true;
  const groupSize = readNumber(metadata.instanceGroupSize) ?? 0;
  const vmssCount = readNumber(metadata.vmssInstanceCount) ?? 0;
  return groupSize > 1 || vmssCount > 1;
}

export function detectSPOFs(graph: GraphInstance, resolver: CloudServiceResolver): SPOFReport[] {
  const spofs: SPOFReport[] = [];
  if (graph.order === 0) return spofs;

  const articulationPoints = findArticulationPoints(graph);

  for (const nodeId of articulationPoints) {
    const blast = getBlastRadius(graph, nodeId);
    const attrs = graph.getNodeAttributes(nodeId) as unknown as InfraNodeAttrs;
    if (!isAnalyzableServiceNode(attrs)) continue;
    if (isManagedServiceSpofExempt(attrs, resolver)) continue;

    upsertSpof(spofs, {
      nodeId,
      nodeName: attrs.name,
      nodeType: attrs.type,
      severity: severityFromBlastRadius(blast.length, graph.order),
      blastRadius: blast.length,
      impactedServices: blast.map((n) => n.name),
      recommendation: generateSPOFRecommendation(attrs, blast.length),
    });
  }

  graph.forEachNode((nodeId, rawAttrs) => {
    const a = rawAttrs as unknown as InfraNodeAttrs;
    if (!isAnalyzableServiceNode(a)) return;
    if (isManagedServiceSpofExempt(a, resolver)) return;
    const inDeg = graph.inDegree(nodeId);
    if (inDeg > 10 && !articulationPoints.has(nodeId)) {
      upsertSpof(spofs, {
        nodeId,
        nodeName: a.name,
        nodeType: a.type,
        severity: 'medium',
        blastRadius: inDeg,
        impactedServices: graph
          .inNeighbors(nodeId)
          .map((id) => (graph.getNodeAttributes(id) as unknown as InfraNodeAttrs).name),
        recommendation: `${a.name} has ${inDeg} direct dependents. Consider adding a load balancer or replication.`,
      });
    }
  });

  for (const s of detectExplicitServiceSpofs(graph, resolver)) {
    upsertSpof(spofs, s);
  }

  return spofs.sort((a, b) => b.blastRadius - a.blastRadius);
}

function detectExplicitServiceSpofs(
  graph: GraphInstance,
  resolver: CloudServiceResolver,
): SPOFReport[] {
  const spofs: SPOFReport[] = [];
  const vmNodes: InfraNodeAttrs[] = [];
  graph.forEachNode((_nodeId, rawAttrs) => {
    const node = rawAttrs as unknown as InfraNodeAttrs;
    if (isVmServiceNode(node)) vmNodes.push(node);
  });

  const vmAzValues = vmNodes
    .map((n) => getAvailabilityZone(n))
    .filter((az): az is string => Boolean(az));
  const vmAzSet = new Set(vmAzValues);
  const vmSameAzRisk = vmNodes.length > 1 && vmAzSet.size === 1;

  addVmSpofs(vmNodes, vmSameAzRisk, graph, spofs);
  addDatabaseAndCacheSpofs(graph, resolver, spofs);

  return spofs;
}

function addVmSpofs(
  vmNodes: InfraNodeAttrs[],
  vmSameAzRisk: boolean,
  graph: GraphInstance,
  spofs: SPOFReport[],
): void {
  for (const node of vmNodes) {
    if (hasElasticScaling(node)) continue;
    const isSingle = vmNodes.length === 1;
    if (!isSingle && !vmSameAzRisk) continue;
    const blast = getBlastRadius(graph, node.id);
    const recommendation = isSingle
      ? `Deploy at least one additional instance for ${node.name} in another availability zone and front it with a load balancer.`
      : `Distribute ${node.name} workload across multiple availability zones to remove single-AZ dependency.`;
    spofs.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      severity: blast.length >= 3 ? 'critical' : 'high',
      blastRadius: blast.length,
      impactedServices: blast.map((i) => i.name),
      recommendation,
    });
  }
}

function addDatabaseAndCacheSpofs(
  graph: GraphInstance,
  resolver: CloudServiceResolver,
  spofs: SPOFReport[],
): void {
  graph.forEachNode((nodeId, rawAttrs) => {
    const node = rawAttrs as unknown as InfraNodeAttrs;
    if (!isAnalyzableServiceNode(node)) return;
    const metadata = getMetadata(node);
    const resolution = resolveNode(node, resolver);

    if (node.type === NodeType.DATABASE) {
      addDbSpof(node, nodeId, metadata, resolution, graph, spofs, resolver);
    } else if (node.type === NodeType.CACHE) {
      addCacheSpof(node, nodeId, metadata, graph, spofs);
    }
  });
}

function addDbSpof(
  node: InfraNodeAttrs,
  nodeId: string,
  metadata: Record<string, unknown>,
  resolution: { readonly kind: string },
  graph: GraphInstance,
  spofs: SPOFReport[],
  resolver: CloudServiceResolver,
): void {
  if (isManagedNoSqlSpofExempt(node, resolver)) return;
  const availType = (readString(metadata.availabilityType) || '').toUpperCase();
  const haMode = (readString(metadata.highAvailabilityMode) || '').toLowerCase();
  const hasGeoRep =
    (Array.isArray(metadata.geoReplicationLinks) && metadata.geoReplicationLinks.length > 0) ||
    Boolean(readString(metadata.failoverGroupId));
  const flexHa = haMode.length > 0 && !haMode.includes('disable');
  const multiAz = isMultiAzEnabled(metadata);
  const hasReplica = getReplicaCount(metadata) > 0;
  const isBigtable = resolution.kind === 'bigTable';
  const btClusterCount =
    readNumber(metadata.clusterCount) ?? readNumber(metadata.clustersCount) ?? 1;
  const btSingle = isBigtable && btClusterCount <= 1;
  const hasHa = multiAz || hasReplica || availType === 'REGIONAL' || flexHa || hasGeoRep;

  if (!btSingle && hasHa) return;
  const rec = btSingle
    ? `Add a replicated Bigtable cluster in another zone/region for ${node.name}.`
    : `Enable high availability or replication for ${node.name} (multi-zone or synchronous standby).`;
  const blast = getBlastRadius(graph, nodeId);
  spofs.push({
    nodeId,
    nodeName: node.name,
    nodeType: node.type,
    severity: blast.length >= 3 ? 'critical' : 'high',
    blastRadius: blast.length,
    impactedServices: blast.map((i) => i.name),
    recommendation: rec,
  });
}

function addCacheSpof(
  node: InfraNodeAttrs,
  nodeId: string,
  metadata: Record<string, unknown>,
  graph: GraphInstance,
  spofs: SPOFReport[],
): void {
  const tier = (
    readString(metadata.tier) ??
    readString(metadata.sku_name) ??
    readString(metadata.skuName) ??
    readString(metadata.sku) ??
    ''
  ).toUpperCase();
  const numNodes =
    readNumber(metadata.numCacheNodes) ??
    readNumber(metadata.num_cache_nodes) ??
    readNumber(metadata.cacheNodes);
  const replicas = getReplicaCount(metadata);
  const repGroup = readString(metadata.replicationGroupId) ?? readString(metadata.replicationGroup);
  const hasTierRep =
    tier.includes('STANDARD') || tier.includes('PREMIUM') || tier.includes('STANDARD_HA');
  const singleNode = numNodes != null ? numNodes <= 1 : !hasTierRep && replicas <= 0;
  const missingRep = !hasTierRep && !repGroup && replicas <= 0;
  const basicTier = tier.includes('BASIC');

  if (!singleNode && !missingRep && !basicTier) return;
  const rec = basicTier
    ? `Migrate ${node.name} from Basic to a replicated cache tier (Standard/Premium or STANDARD_HA).`
    : `Enable replication group / cluster mode for ${node.name} with at least 2 cache nodes.`;
  const blast = getBlastRadius(graph, nodeId);
  spofs.push({
    nodeId,
    nodeName: node.name,
    nodeType: node.type,
    severity: blast.length >= 3 ? 'critical' : 'high',
    blastRadius: blast.length,
    impactedServices: blast.map((i) => i.name),
    recommendation: rec,
  });
}
