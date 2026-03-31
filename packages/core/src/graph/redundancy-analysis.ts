/**
 * Redundancy analysis — checks each service node for missing
 * Multi-AZ, replicas, load balancers, backups, and DLQ.
 */

import type {
  InfraNodeAttrs,
  InfraEdgeAttrs,
  RedundancyIssue,
  RedundancyCheck,
} from '../types/index.js';
import { NodeType, EdgeType } from '../types/index.js';
import type { CloudServiceResolver } from '../ports/cloud-service-resolver.js';
import type { GraphInstance } from './graph-instance.js';
import { isAnalyzableServiceNode } from './service-classification.js';
import {
  getMetadata,
  readString,
  readNumber,
  isMultiAzEnabled,
  getReplicaCount,
  getAvailabilityZone,
  hasDeadLetterQueue,
  isManagedNoSqlSpofExempt,
  isS3LikeObjectStorage,
  isSqsLikeQueue,
} from './analysis-helpers.js';
import { isVmServiceNode, hasElasticScaling } from './spof-detection.js';

export function analyzeRedundancy(
  graph: GraphInstance,
  resolver: CloudServiceResolver,
): RedundancyIssue[] {
  const issues: RedundancyIssue[] = [];
  const vmNodes: InfraNodeAttrs[] = [];

  graph.forEachNode((_nodeId, rawAttrs) => {
    const node = rawAttrs as unknown as InfraNodeAttrs;
    if (isVmServiceNode(node) && !hasElasticScaling(node)) {
      vmNodes.push(node);
    }
  });

  const vmAzSet = new Set(
    vmNodes.map((n) => getAvailabilityZone(n)).filter((az): az is string => Boolean(az)),
  );
  const vmSingleInstance = vmNodes.length === 1;
  const vmSingleAz = vmNodes.length > 1 && vmAzSet.size === 1;

  graph.forEachNode((nodeId, rawAttrs) => {
    const a = rawAttrs as unknown as InfraNodeAttrs;
    if (!isAnalyzableServiceNode(a)) return;

    const metadata = getMetadata(a);
    const checks: RedundancyCheck[] = [];
    const isNoSql = a.type === NodeType.DATABASE && isManagedNoSqlSpofExempt(a, resolver);

    addMultiAzCheck(a, metadata, isNoSql, checks);
    addReplicaCheck(a, metadata, isNoSql, checks);
    addCacheReplicationCheck(a, metadata, checks);
    addLoadBalancerCheck(a, nodeId, graph, checks);
    addVmDistributionCheck(a, vmSingleInstance, vmSingleAz, checks);
    addSingleRegionCheck(a, nodeId, graph, checks);
    addDlqCheck(a, metadata, resolver, checks);
    addBackupCheck(a, nodeId, isNoSql, graph, resolver, checks);

    const failedChecks = checks.filter((c) => !c.passed);
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

function addMultiAzCheck(
  a: InfraNodeAttrs,
  metadata: Record<string, unknown>,
  isNoSql: boolean,
  checks: RedundancyCheck[],
): void {
  if (isNoSql) return;
  if (![NodeType.DATABASE, NodeType.CACHE].includes(a.type as NodeType)) return;
  if (isMultiAzEnabled(metadata)) return;
  checks.push({
    check: 'multi_az',
    passed: false,
    recommendation: `Enable Multi-AZ for ${a.name}`,
    impact: 'high',
  });
}

function addReplicaCheck(
  a: InfraNodeAttrs,
  metadata: Record<string, unknown>,
  isNoSql: boolean,
  checks: RedundancyCheck[],
): void {
  if (isNoSql || a.type !== NodeType.DATABASE || getReplicaCount(metadata) > 0) return;
  checks.push({
    check: 'read_replicas',
    passed: false,
    recommendation: `Add at least one read replica for ${a.name}`,
    impact: 'high',
  });
}

function addCacheReplicationCheck(
  a: InfraNodeAttrs,
  metadata: Record<string, unknown>,
  checks: RedundancyCheck[],
): void {
  if (a.type !== NodeType.CACHE) return;
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
  const basic = tier.includes('BASIC');
  if (singleNode || missingRep || basic) {
    checks.push({
      check: 'cache_replication',
      passed: false,
      recommendation: `Enable replication group / cluster mode for ${a.name}`,
      impact: 'high',
    });
  }
}

function addLoadBalancerCheck(
  a: InfraNodeAttrs,
  nodeId: string,
  graph: GraphInstance,
  checks: RedundancyCheck[],
): void {
  if (![NodeType.VM, NodeType.CONTAINER].includes(a.type as NodeType)) return;
  const hasLB = graph
    .inNeighbors(nodeId)
    .some(
      (id) =>
        (graph.getNodeAttributes(id) as unknown as InfraNodeAttrs).type === NodeType.LOAD_BALANCER,
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

function addVmDistributionCheck(
  a: InfraNodeAttrs,
  vmSingleInstance: boolean,
  vmSingleAz: boolean,
  checks: RedundancyCheck[],
): void {
  if (!isVmServiceNode(a) || hasElasticScaling(a)) return;
  if (vmSingleInstance) {
    checks.push({
      check: 'single_instance',
      passed: false,
      recommendation: `${a.name} is a single compute instance without elastic group scaling`,
      impact: 'critical',
    });
  } else if (vmSingleAz) {
    checks.push({
      check: 'single_az_distribution',
      passed: false,
      recommendation: `${a.name} fleet is concentrated in one availability zone`,
      impact: 'high',
    });
  }
}

function addSingleRegionCheck(
  a: InfraNodeAttrs,
  nodeId: string,
  graph: GraphInstance,
  checks: RedundancyCheck[],
): void {
  const dependents = graph.inNeighbors(nodeId);
  if (dependents.length <= 3) return;
  const regions = new Set(
    dependents
      .map((id) => (graph.getNodeAttributes(id) as unknown as InfraNodeAttrs).region)
      .filter(Boolean),
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

function addDlqCheck(
  a: InfraNodeAttrs,
  metadata: Record<string, unknown>,
  resolver: CloudServiceResolver,
  checks: RedundancyCheck[],
): void {
  if (!isSqsLikeQueue(a, resolver)) return;
  if (hasDeadLetterQueue(metadata)) return;
  checks.push({
    check: 'dlq',
    passed: false,
    recommendation: `Configure a dead-letter queue for ${a.name}`,
    impact: 'low',
  });
}

function addBackupCheck(
  a: InfraNodeAttrs,
  nodeId: string,
  isNoSql: boolean,
  graph: GraphInstance,
  resolver: CloudServiceResolver,
  checks: RedundancyCheck[],
): void {
  const hasBackup = graph
    .outEdges(nodeId)
    .some(
      (ek) =>
        (graph.getEdgeAttributes(ek) as unknown as InfraEdgeAttrs).type === EdgeType.BACKS_UP_TO,
    );
  const shouldCheck =
    (!isNoSql && a.type === NodeType.DATABASE) ||
    (a.type === NodeType.OBJECT_STORAGE && !isS3LikeObjectStorage(a, resolver));
  if (!hasBackup && shouldCheck) {
    checks.push({
      check: 'backup',
      passed: false,
      recommendation: `No backup detected for ${a.name}`,
      impact: 'critical',
    });
  }
}
