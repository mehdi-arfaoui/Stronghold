import { getNodeCategory, isInfrastructureNode } from '@/lib/graph-visuals';
import type { InfraNode, NodeType } from '@/types/graph.types';

export type DiscoveryDomain = 'foundation' | 'platform' | 'application' | 'network';
export type CriticalityFilter = 'all' | 'high' | 'medium' | 'low' | 'unknown';

export const DISCOVERY_DOMAIN_LABELS: Record<DiscoveryDomain, string> = {
  foundation: 'Foundation',
  platform: 'Platform',
  application: 'Application',
  network: 'Network',
};

const APPLICATION_TYPES = new Set<NodeType>([
  'APPLICATION',
  'MICROSERVICE',
  'SAAS_SERVICE',
  'THIRD_PARTY_API',
]);

const PLATFORM_TYPES = new Set<NodeType>([
  'VM',
  'CONTAINER',
  'KUBERNETES_CLUSTER',
  'SERVERLESS',
  'LOAD_BALANCER',
  'API_GATEWAY',
  'CDN',
  'PHYSICAL_SERVER',
]);

const FOUNDATION_TYPES = new Set<NodeType>([
  'DATABASE',
  'CACHE',
  'OBJECT_STORAGE',
  'MESSAGE_QUEUE',
  'DNS',
]);

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toShortLabel(value: string, maxLength = 28): string {
  if (value.length <= maxLength) return value;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const compact = words.slice(0, 3).join(' ');
    if (compact.length <= maxLength) return compact;
  }
  return `${value.slice(0, Math.max(1, maxLength - 3))}...`;
}

function extractTagName(metadata: Record<string, unknown>): string | null {
  const direct =
    readString(metadata.tagName) ||
    readString(metadata.resourceLabel) ||
    readString(metadata.logicalName);
  if (direct) return direct;

  const tags = toRecord(metadata.tags);
  return (
    readString(tags.Name) ||
    readString(tags.name) ||
    readString(tags.DisplayName) ||
    readString(tags.display_name) ||
    null
  );
}

function extractMotif(metadata: Record<string, unknown>): string | null {
  return (
    readString(metadata.displayName) ||
    readString(metadata.inferredName) ||
    readString(metadata.patternName) ||
    readString(metadata.serviceName) ||
    null
  );
}

export function getDiscoveryNodeTier(node: Pick<InfraNode, 'metadata'>): number | null {
  const metadata = toRecord(node.metadata);
  const value =
    readNumber(metadata.tier) ??
    readNumber(metadata.recoveryTier) ??
    readNumber(metadata.criticalityTier);
  if (value == null) return null;
  const tier = Math.round(value);
  if (tier < 1 || tier > 4) return null;
  return tier;
}

export function getCriticalityBucket(value: unknown): CriticalityFilter {
  const numeric = readNumber(value);
  if (numeric == null) return 'unknown';
  if (numeric >= 70) return 'high';
  if (numeric >= 40) return 'medium';
  return 'low';
}

export function matchesCriticalityFilter(value: unknown, filter: CriticalityFilter): boolean {
  if (filter === 'all') return true;
  return getCriticalityBucket(value) === filter;
}

export function getDiscoveryNodeDomain(node: Pick<InfraNode, 'type' | 'metadata' | 'name'>): DiscoveryDomain {
  if (isInfrastructureNode(node)) {
    return 'network';
  }

  if (APPLICATION_TYPES.has(node.type)) {
    return 'application';
  }
  if (PLATFORM_TYPES.has(node.type)) {
    return 'platform';
  }
  if (FOUNDATION_TYPES.has(node.type)) {
    return 'foundation';
  }

  const category = getNodeCategory(node);
  if (category === 'network') return 'network';
  if (category === 'compute' || category === 'serverless' || category === 'loadbalancer') return 'platform';
  if (category === 'database' || category === 'storage' || category === 'messaging') return 'foundation';
  return 'foundation';
}

export function resolveDiscoveryNodeLabels(node: Pick<InfraNode, 'id' | 'name' | 'businessName' | 'displayName' | 'technicalName' | 'metadata'>): {
  shortLabel: string;
  fullLabel: string;
  technicalLabel: string;
  secondaryLabel: string | null;
} {
  const metadata = toRecord(node.metadata);
  const technicalLabel = readString(node.technicalName) || readString(node.name) || readString(node.id) || 'Service';
  const fullLabel =
    readString(node.businessName) ||
    extractTagName(metadata) ||
    readString(node.displayName) ||
    extractMotif(metadata) ||
    technicalLabel;
  const shortLabel = toShortLabel(fullLabel);
  const secondaryLabel = technicalLabel !== fullLabel ? technicalLabel : null;

  return {
    shortLabel,
    fullLabel,
    technicalLabel,
    secondaryLabel,
  };
}

export function getDiscoveryNodeSearchText(node: Pick<InfraNode, 'id' | 'name' | 'businessName' | 'displayName' | 'technicalName' | 'type' | 'provider' | 'region' | 'metadata'>): string {
  const labels = resolveDiscoveryNodeLabels(node);
  const metadata = toRecord(node.metadata);
  const tags = toRecord(metadata.tags);
  return [
    labels.shortLabel,
    labels.fullLabel,
    labels.technicalLabel,
    node.id,
    node.name,
    node.type,
    node.provider,
    node.region,
    readString(metadata.serviceType),
    readString(metadata.resourceType),
    readString(tags.Name),
    readString(tags.name),
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .toLowerCase();
}

function readObjective(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = readString(metadata[key]) ?? readNumber(metadata[key])?.toString();
    if (value) return value;
  }
  return null;
}

export function buildDiscoveryNodeTooltip(node: Pick<InfraNode, 'id' | 'type' | 'name' | 'provider' | 'region' | 'metadata' | 'criticality' | 'businessName' | 'displayName' | 'technicalName'>): string {
  const labels = resolveDiscoveryNodeLabels(node);
  const metadata = toRecord(node.metadata);
  const criticality = readNumber(node.criticality);
  const rto = readObjective(metadata, ['rto', 'rtoMinutes', 'recoveryTimeObjective']);
  const rpo = readObjective(metadata, ['rpo', 'rpoMinutes', 'recoveryPointObjective']);
  const services = Array.isArray(metadata.services)
    ? metadata.services
        .map((value) => readString(value))
        .filter((value): value is string => value !== null)
        .slice(0, 5)
        .join(', ')
    : null;

  const lines = [
    labels.fullLabel,
    `Type: ${node.type}`,
    `Domaine: ${DISCOVERY_DOMAIN_LABELS[getDiscoveryNodeDomain(node)]}`,
  ];

  if (node.provider) lines.push(`Provider: ${node.provider}`);
  if (node.region) lines.push(`Region: ${node.region}`);
  if (criticality != null) lines.push(`Criticite: ${Math.round(criticality)}/100`);
  if (rto) lines.push(`RTO: ${rto}`);
  if (rpo) lines.push(`RPO: ${rpo}`);
  if (services) lines.push(`Services associes: ${services}`);

  return lines.join('\n');
}

