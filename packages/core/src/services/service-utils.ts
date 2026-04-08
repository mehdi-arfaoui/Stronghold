import { getAvailabilityZone, getMetadata, readString } from '../graph/analysis-helpers.js';
import type { InfraNode } from '../validation/validation-types.js';
import { collectNodeKinds } from '../validation/validation-node-utils.js';
import type { Criticality, ResourceRole, Service } from './service-types.js';

const INFRASTRUCTURE_KINDS = new Set([
  'vpc',
  'subnet',
  'security-group',
  'firewall',
  'iam-role',
  'iam-policy',
  'nat-gateway',
  'internet-gateway',
  'network-acl',
  'route-table',
  'network-device',
]);

const COMPUTE_KINDS = new Set([
  'ec2',
  'ec2-instance',
  'lambda',
  'eks',
  'eks-cluster',
  'vm',
  'serverless',
  'container',
  'kubernetes-cluster',
]);

const DATASTORE_KINDS = new Set([
  'rds',
  'rds-instance',
  'aurora',
  'aurora-cluster',
  'aurora-instance',
  'dynamodb',
  'elasticache',
  'database',
  'cache',
]);

const QUEUE_KINDS = new Set(['sqs', 'sns', 'message-queue']);
const STORAGE_KINDS = new Set([
  's3',
  's3-bucket',
  'efs',
  'efs-filesystem',
  'object-storage',
  'file-storage',
]);
const NETWORK_KINDS = new Set(['elb', 'load-balancer', 'vpc', 'subnet', 'api-gateway']);
const MONITORING_KINDS = new Set(['cloudwatch-alarm']);
const DNS_KINDS = new Set(['dns', 'route53-record', 'route53-hosted-zone']);

const ENVIRONMENT_SUFFIXES = [
  '-prod',
  '-production',
  '-staging',
  '-stage',
  '-dev',
  '-test',
  '-qa',
];

export function resolveNodeTags(node: InfraNode): Record<string, string> {
  const metadata = getMetadata(node);
  const rawMetadataTags = metadata.tags;
  const metadataTags =
    rawMetadataTags && typeof rawMetadataTags === 'object' && !Array.isArray(rawMetadataTags)
      ? Object.fromEntries(
          Object.entries(rawMetadataTags as Record<string, unknown>).flatMap(([key, value]) => {
            const parsed = readString(value);
            return parsed ? [[key, parsed] as const] : [];
          }),
        )
      : {};

  return {
    ...metadataTags,
    ...node.tags,
  };
}

export function resolveTagValue(node: InfraNode, key: string): string | null {
  const tags = resolveNodeTags(node);
  const lowerKey = key.toLowerCase();

  for (const [tagKey, tagValue] of Object.entries(tags)) {
    if (tagKey.toLowerCase() === lowerKey) {
      return tagValue;
    }
  }

  return null;
}

export function classifyResourceRole(node: InfraNode): ResourceRole {
  const kinds = collectNodeKinds(node);

  if (hasAnyKind(kinds, DATASTORE_KINDS)) return 'datastore';
  if (hasAnyKind(kinds, COMPUTE_KINDS)) return 'compute';
  if (hasAnyKind(kinds, QUEUE_KINDS)) return 'queue';
  if (hasAnyKind(kinds, STORAGE_KINDS)) return 'storage';
  if (hasAnyKind(kinds, MONITORING_KINDS)) return 'monitoring';
  if (hasAnyKind(kinds, DNS_KINDS)) return 'dns';
  if (hasAnyKind(kinds, NETWORK_KINDS)) return 'network';
  return 'other';
}

export function isInfrastructureNode(node: InfraNode): boolean {
  return hasAnyKind(collectNodeKinds(node), INFRASTRUCTURE_KINDS);
}

export function isApplicationStackCandidate(node: InfraNode): boolean {
  const role = classifyResourceRole(node);
  return role === 'compute' || role === 'datastore' || role === 'queue' || role === 'storage';
}

export function deriveCriticality(nodes: readonly InfraNode[]): Criticality {
  const explicit = nodes
    .map((node) => readString(getMetadata(node).criticality)?.toLowerCase())
    .find(
      (value): value is Criticality =>
        value === 'critical' || value === 'high' || value === 'medium' || value === 'low',
    );
  if (explicit) {
    return explicit;
  }

  const highestScore = nodes.reduce((current, node) => {
    const score =
      typeof node.criticalityScore === 'number'
        ? node.criticalityScore
        : typeof getMetadata(node).criticalityScore === 'number'
          ? (getMetadata(node).criticalityScore as number)
          : 0;
    return Math.max(current, score);
  }, 0);

  if (highestScore >= 80) return 'critical';
  if (highestScore >= 60) return 'high';
  if (highestScore >= 40) return 'medium';
  return 'low';
}

export function cleanServiceName(value: string): string {
  let cleaned = value.trim();
  if (cleaned.endsWith('Stack')) {
    cleaned = cleaned.slice(0, -'Stack'.length);
  }
  cleaned = cleaned.replace(/-stack$/i, '');
  for (const suffix of ENVIRONMENT_SUFFIXES) {
    cleaned = cleaned.replace(new RegExp(`${escapeRegex(suffix)}$`, 'i'), '');
  }
  return cleaned.trim().replace(/[-_.\s]+$/, '') || value.trim();
}

export function slugifyServiceId(value: string): string {
  return cleanServiceName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function readNameTag(node: InfraNode): string | null {
  const tags = resolveNodeTags(node);
  for (const [tagKey, tagValue] of Object.entries(tags)) {
    if (tagKey.toLowerCase() === 'name') {
      return tagValue;
    }
  }
  return null;
}

export function extractPrefixCandidate(value: string): string | null {
  const match = value.match(/^([a-z0-9][a-z0-9-]{2,})([-_.])/i);
  if (!match) {
    return null;
  }

  const prefix = match[1]?.trim();
  return prefix && prefix.length >= 4 ? prefix : null;
}

export function normalizeEdgeType(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function hasSharedAvailabilityPattern(nodes: readonly InfraNode[]): boolean {
  const zones = nodes
    .map((node) => getAvailabilityZone(node))
    .filter((zone): zone is string => zone !== null);
  if (zones.length < 2) {
    return false;
  }

  const patterns = new Set(zones.map((zone) => zone.slice(0, -1)));
  return patterns.size === 1;
}

export function buildServiceIndex(services: readonly Service[]): Map<string, Service> {
  const index = new Map<string, Service>();
  for (const service of services) {
    for (const resource of service.resources) {
      index.set(resource.nodeId, service);
    }
  }
  return index;
}

function hasAnyKind(kinds: ReadonlySet<string>, expectedKinds: ReadonlySet<string>): boolean {
  for (const expectedKind of expectedKinds) {
    if (kinds.has(expectedKind)) {
      return true;
    }
  }
  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
