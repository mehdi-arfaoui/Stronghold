/**
 * Shared helper functions for graph analysis.
 * Used by SPOF detection, redundancy analysis, and criticality scoring.
 */

import type { InfraNodeAttrs, SPOFReport, Severity } from '../types/index.js';
import { NodeType } from '../types/index.js';
import type { CloudServiceResolution } from '../types/cloud-service.js';
import type { CloudServiceResolver } from '../ports/cloud-service-resolver.js';

export function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

export function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getMetadata(node: InfraNodeAttrs): Record<string, unknown> {
  return node.metadata && typeof node.metadata === 'object'
    ? (node.metadata as Record<string, unknown>)
    : {};
}

export function getReplicaCount(metadata: Record<string, unknown>): number {
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

export function isMultiAzEnabled(metadata: Record<string, unknown>): boolean {
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

export function getAvailabilityZone(node: InfraNodeAttrs): string | null {
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

export function hasDeadLetterQueue(metadata: Record<string, unknown>): boolean {
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

export function severityFromBlastRadius(blastRadius: number, totalNodes: number): Severity {
  const ratio = totalNodes > 0 ? blastRadius / totalNodes : 0;
  if (ratio > 0.5) return 'critical';
  if (ratio > 0.2) return 'high';
  if (blastRadius > 5) return 'medium';
  return 'low';
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function upsertSpof(target: SPOFReport[], candidate: SPOFReport): void {
  const index = target.findIndex((e) => e.nodeId === candidate.nodeId);
  if (index < 0) {
    target.push(candidate);
    return;
  }
  const existing = target[index]!;
  const merged = Array.from(new Set([...existing.impactedServices, ...candidate.impactedServices]));
  const stronger =
    SEVERITY_ORDER[candidate.severity] > SEVERITY_ORDER[existing.severity] ||
    candidate.blastRadius > existing.blastRadius;

  target[index] = stronger
    ? { ...candidate, impactedServices: merged }
    : { ...existing, impactedServices: merged };
}

export const DEFAULT_RESOLVER: CloudServiceResolver = (opts) => ({
  provider: 'other',
  category: 'unknown',
  kind: opts.nodeType,
  nodeType: opts.nodeType,
  sourceType: '',
  metadata: {},
  descriptors: [],
});

export function resolveNode(
  node: InfraNodeAttrs,
  resolver: CloudServiceResolver,
): CloudServiceResolution {
  return resolver({
    provider: node.provider,
    nodeType: node.type,
    metadata: getMetadata(node),
  });
}

export function isManagedNoSqlSpofExempt(
  node: InfraNodeAttrs,
  resolver: CloudServiceResolver,
): boolean {
  const r = resolveNode(node, resolver);
  return r.kind === 'dynamodb' || r.kind === 'firestore' || r.kind === 'cosmosdb';
}

export function isS3LikeObjectStorage(
  node: InfraNodeAttrs,
  resolver: CloudServiceResolver,
): boolean {
  if (node.type !== NodeType.OBJECT_STORAGE) return false;
  const r = resolveNode(node, resolver);
  return r.kind === 's3' || r.kind === 'storageAccount' || r.kind === 'cloudStorage';
}

export function isManagedQueue(node: InfraNodeAttrs, resolver: CloudServiceResolver): boolean {
  if (node.type !== NodeType.MESSAGE_QUEUE) return false;
  const r = resolveNode(node, resolver);
  return (
    r.kind === 'sqs' ||
    r.kind === 'sns' ||
    r.kind === 'serviceBus' ||
    r.kind === 'eventGrid' ||
    r.kind === 'pubsub' ||
    r.kind === 'cloudTasks'
  );
}

export function isSqsLikeQueue(node: InfraNodeAttrs, resolver: CloudServiceResolver): boolean {
  if (node.type !== NodeType.MESSAGE_QUEUE) return false;
  const r = resolveNode(node, resolver);
  return r.kind === 'sqs';
}

export function isManagedServiceSpofExempt(
  node: InfraNodeAttrs,
  resolver: CloudServiceResolver,
): boolean {
  if (node.type === NodeType.SERVERLESS) return true;
  if (node.type === NodeType.DATABASE && isManagedNoSqlSpofExempt(node, resolver)) return true;
  if (isS3LikeObjectStorage(node, resolver)) return true;
  if (isManagedQueue(node, resolver)) return true;
  return false;
}
