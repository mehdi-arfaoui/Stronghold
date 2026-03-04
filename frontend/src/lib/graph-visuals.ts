import type { CSSProperties } from 'react';
import type { EdgeType, InfraEdge, InfraNode, NodeType } from '@/types/graph.types';

export type GraphCategory =
  | 'database'
  | 'compute'
  | 'network'
  | 'storage'
  | 'serverless'
  | 'messaging'
  | 'external'
  | 'loadbalancer';

interface NodeLayerSource {
  type?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

interface NetworkGroup {
  key: string;
  label: string;
}

const ENTRY_POINT_KEYWORDS = [
  'alb',
  'nlb',
  'elb',
  'load balancer',
  'load_balancer',
  'gateway',
  'waf',
  'cloudfront',
  'frontdoor',
  'ingress',
];

const COMPUTE_KEYWORDS = [
  'ec2',
  'vm',
  'ecs',
  'eks',
  'aks',
  'gke',
  'compute',
  'container',
  'kubernetes',
  'app service',
  'application',
  'microservice',
  'server',
];

const SERVERLESS_KEYWORDS = [
  'lambda',
  'serverless',
  'function',
  'cloud run',
  'cloud function',
];

const DATA_KEYWORDS = [
  'database',
  'rds',
  'aurora',
  'dynamodb',
  'elasticache',
  'redis',
  'postgres',
  'mysql',
  'sql',
  's3',
  'storage',
  'bucket',
  'blob',
  'cosmosdb',
  'firestore',
  'memorystore',
];

const MESSAGING_KEYWORDS = [
  'queue',
  'sqs',
  'sns',
  'eventbridge',
  'service bus',
  'servicebus',
  'event grid',
  'eventgrid',
  'pubsub',
  'kafka',
  'rabbitmq',
];

const NETWORK_INFRA_KEYWORDS = [
  'vpc',
  'vnet',
  'subnet',
  'securitygroup',
  'security group',
  'nsg',
  'route table',
  'routetable',
  'internet gateway',
  'igw',
  'nat gateway',
  'nat',
  'network interface',
  'eni',
  'elastic ip',
  'eip',
  'vpc endpoint',
  'transit gateway',
  'peering',
  'network acl',
  'acl',
];

const NODE_TYPE_LAYER_MAP: Partial<Record<NodeType, number>> = {
  LOAD_BALANCER: 0,
  API_GATEWAY: 0,
  CDN: 0,
  VM: 1,
  CONTAINER: 1,
  KUBERNETES_CLUSTER: 1,
  APPLICATION: 1,
  MICROSERVICE: 1,
  PHYSICAL_SERVER: 1,
  SERVERLESS: 2,
  DATABASE: 3,
  CACHE: 3,
  OBJECT_STORAGE: 3,
  MESSAGE_QUEUE: 4,
  VPC: 5,
  SUBNET: 5,
  FIREWALL: 5,
  REGION: 5,
  AVAILABILITY_ZONE: 5,
};

const INFRA_NODE_TYPES = new Set<NodeType>([
  'VPC',
  'SUBNET',
  'FIREWALL',
  'REGION',
  'AVAILABILITY_ZONE',
]);

const CATEGORY_BY_TYPE: Partial<Record<NodeType, GraphCategory>> = {
  DATABASE: 'database',
  CACHE: 'database',
  VM: 'compute',
  CONTAINER: 'compute',
  KUBERNETES_CLUSTER: 'compute',
  APPLICATION: 'compute',
  MICROSERVICE: 'compute',
  PHYSICAL_SERVER: 'compute',
  LOAD_BALANCER: 'loadbalancer',
  API_GATEWAY: 'loadbalancer',
  CDN: 'loadbalancer',
  VPC: 'network',
  SUBNET: 'network',
  DNS: 'network',
  FIREWALL: 'network',
  REGION: 'network',
  AVAILABILITY_ZONE: 'network',
  OBJECT_STORAGE: 'storage',
  SERVERLESS: 'serverless',
  MESSAGE_QUEUE: 'messaging',
  THIRD_PARTY_API: 'external',
  SAAS_SERVICE: 'external',
};

export const CATEGORY_COLORS: Record<GraphCategory, { bg: string; border: string; text: string }> = {
  database: { bg: '#2D1B4E', border: '#9F7AEA', text: '#E9D5FF' },
  compute: { bg: '#1A365D', border: '#4299E1', text: '#BEE3F8' },
  network: { bg: '#744210', border: '#ED8936', text: '#FEEBC8' },
  storage: { bg: '#22543D', border: '#48BB78', text: '#C6F6D5' },
  serverless: { bg: '#44337A', border: '#B794F4', text: '#E9D8FD' },
  messaging: { bg: '#285E61', border: '#4FD1C5', text: '#B2F5EA' },
  external: { bg: '#1A202C', border: '#A0AEC0', text: '#E2E8F0' },
  loadbalancer: { bg: '#553C9A', border: '#805AD5', text: '#D6BCFA' },
};

export const INFRA_TYPES_TO_HIDE = [
  'vpc',
  'vnet',
  'subnet',
  'securitygroup',
  'security group',
  'nsg',
  'route table',
  'routetable',
  'internet gateway',
  'igw',
  'nat gateway',
  'nat',
  'network interface',
  'eni',
  'elastic ip',
  'eip',
  'vpc endpoint',
  'transit gateway',
  'peering',
  'network acl',
];

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function toCleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[_-]/g, ' ');
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function buildNodeDescriptor(node: NodeLayerSource): string {
  const metadata = toRecord(node.metadata) || {};
  const metadataKeys = [
    'sourceType',
    'awsService',
    'subType',
    'serviceType',
    'resourceType',
    'kind',
    'vpcId',
    'vnetId',
    'subnetId',
  ];
  const metadataValues = metadataKeys
    .map((key) => toCleanString(metadata[key]))
    .filter((value): value is string => Boolean(value));

  const parts = [node.type, node.name, ...metadataValues]
    .map((value) => toCleanString(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => normalize(value));

  return parts.join(' ').trim();
}

export function getNodeLayer(node: NodeLayerSource): number {
  const rawType = toCleanString(node.type)?.toUpperCase() as NodeType | undefined;
  if (rawType && NODE_TYPE_LAYER_MAP[rawType] !== undefined) {
    return NODE_TYPE_LAYER_MAP[rawType] as number;
  }

  const descriptor = buildNodeDescriptor(node);
  if (includesAny(descriptor, ENTRY_POINT_KEYWORDS)) return 0;
  if (includesAny(descriptor, COMPUTE_KEYWORDS)) return 1;
  if (includesAny(descriptor, SERVERLESS_KEYWORDS)) return 2;
  if (includesAny(descriptor, DATA_KEYWORDS)) return 3;
  if (includesAny(descriptor, MESSAGING_KEYWORDS)) return 4;
  if (includesAny(descriptor, NETWORK_INFRA_KEYWORDS)) return 5;
  return 3;
}

export function getNodeCategory(node: NodeLayerSource): GraphCategory {
  const rawType = toCleanString(node.type)?.toUpperCase() as NodeType | undefined;
  if (rawType && CATEGORY_BY_TYPE[rawType]) {
    return CATEGORY_BY_TYPE[rawType] as GraphCategory;
  }

  const descriptor = buildNodeDescriptor(node);
  if (includesAny(descriptor, ENTRY_POINT_KEYWORDS)) return 'loadbalancer';
  if (includesAny(descriptor, COMPUTE_KEYWORDS)) return 'compute';
  if (includesAny(descriptor, SERVERLESS_KEYWORDS)) return 'serverless';
  if (includesAny(descriptor, DATA_KEYWORDS)) return 'database';
  if (includesAny(descriptor, MESSAGING_KEYWORDS)) return 'messaging';
  if (includesAny(descriptor, NETWORK_INFRA_KEYWORDS)) return 'network';
  return 'external';
}

export function isInfrastructureNode(node: NodeLayerSource): boolean {
  const rawType = toCleanString(node.type)?.toUpperCase() as NodeType | undefined;
  if (rawType && INFRA_NODE_TYPES.has(rawType)) return true;

  const descriptor = buildNodeDescriptor(node);
  return includesAny(descriptor, INFRA_TYPES_TO_HIDE);
}

export function filterServiceNodes(nodes: InfraNode[], showInfrastructure: boolean): InfraNode[] {
  if (showInfrastructure) return nodes;
  return nodes.filter((node) => !isInfrastructureNode(node));
}

export function resolveBlastRatio(node: Pick<InfraNode, 'blastRadius' | 'criticality'>): number {
  const value = Number(node.blastRadius ?? node.criticality ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function getNodeSize(blastRatio: number): { width: number; height: number } {
  if (blastRatio > 0.4) return { width: 240, height: 84 };
  if (blastRatio > 0.15) return { width: 220, height: 72 };
  return { width: 200, height: 60 };
}

export function getTierColor(tier?: number): string {
  switch (tier) {
    case 1:
      return '#E53E3E';
    case 2:
      return '#DD6B20';
    case 3:
      return '#D69E2E';
    case 4:
      return '#718096';
    default:
      return '#718096';
  }
}

export function getNodeTier(metadata: Record<string, unknown> | undefined): number | undefined {
  if (!metadata) return undefined;
  const raw = metadata.tier ?? metadata.recoveryTier ?? metadata.criticalityTier;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  const integer = Math.round(value);
  if (integer < 1 || integer > 4) return undefined;
  return integer;
}

export function getNodeServiceType(node: NodeLayerSource): string {
  const metadata = toRecord(node.metadata);
  const serviceType = toCleanString(
    metadata?.awsService ??
      metadata?.subType ??
      metadata?.serviceType ??
      metadata?.resourceType ??
      node.type,
  );
  return serviceType || 'service';
}

export function getNetworkGroup(node: NodeLayerSource): NetworkGroup | null {
  const metadata = toRecord(node.metadata);
  if (!metadata) return null;

  const vpcId = toCleanString(metadata.vpcId ?? metadata.vnetId ?? metadata.networkId);
  if (vpcId) return { key: `vpc:${vpcId}`, label: `VPC ${compactId(vpcId)}` };

  const subnetId = toCleanString(metadata.subnetId);
  if (subnetId) return { key: `subnet:${subnetId}`, label: `Subnet ${compactId(subnetId)}` };

  const zoneId = toCleanString(metadata.availabilityZone ?? metadata.zone);
  if (zoneId) return { key: `zone:${zoneId}`, label: `Zone ${zoneId}` };

  return null;
}

function compactId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function getEdgeStyle(edgeType: EdgeType | string, inferred?: boolean): CSSProperties {
  const normalized = normalize(String(edgeType));
  let style: CSSProperties;

  switch (normalized) {
    case 'network access':
      style = { stroke: '#4299E1', strokeWidth: 2 };
      break;
    case 'triggers':
      style = { stroke: '#48BB78', strokeWidth: 2, strokeDasharray: '5,5' };
      break;
    case 'uses':
      style = { stroke: '#9F7AEA', strokeWidth: 1.5 };
      break;
    case 'dead letter':
      style = { stroke: '#FC8181', strokeWidth: 1, strokeDasharray: '3,3' };
      break;
    case 'publishes to':
      style = { stroke: '#4FD1C5', strokeWidth: 1.5 };
      break;
    case 'placed in':
      style = { stroke: '#718096', strokeWidth: 1, opacity: 0.4 };
      break;
    case 'secured by':
      style = { stroke: '#718096', strokeWidth: 1, opacity: 0.3 };
      break;
    case 'connects to':
    case 'routes to':
      style = { stroke: '#A0AEC0', strokeWidth: 1.5 };
      break;
    case 'depends on':
      style = { stroke: '#94A3B8', strokeWidth: 1.5 };
      break;
    case 'replicates to':
      style = { stroke: '#22C55E', strokeWidth: 1.8, strokeDasharray: '4,4' };
      break;
    case 'backs up to':
      style = { stroke: '#14B8A6', strokeWidth: 1.8, strokeDasharray: '2,4' };
      break;
    default:
      style = { stroke: '#A0AEC0', strokeWidth: 1 };
      break;
  }

  if (!inferred) return style;
  return {
    ...style,
    strokeDasharray: style.strokeDasharray || '6,4',
    opacity: Math.min(1, Number(style.opacity ?? 1) * 0.9),
  };
}

export function getEdgeHoverLabel(edgeType: EdgeType | string): string {
  const normalized = normalize(String(edgeType));
  if (normalized === 'network access') return 'network access';
  if (normalized === 'triggers') return 'event trigger';
  if (normalized === 'uses') return 'shared dependency';
  if (normalized === 'dead letter') return 'dead letter';
  if (normalized === 'publishes to') return 'publishes';
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function computeBlastRadius(nodeId: string, edges: Array<Pick<InfraEdge, 'id' | 'source' | 'target'>>): {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
} {
  const neighbours = new Map<string, Array<{ nodeId: string; edgeId: string }>>();

  for (const edge of edges) {
    const from = neighbours.get(edge.source) || [];
    from.push({ nodeId: edge.target, edgeId: edge.id });
    neighbours.set(edge.source, from);

    const to = neighbours.get(edge.target) || [];
    to.push({ nodeId: edge.source, edgeId: edge.id });
    neighbours.set(edge.target, to);
  }

  const queue: string[] = [nodeId];
  const visited = new Set<string>([nodeId]);
  const visitedEdges = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const linked = neighbours.get(current) || [];
    for (const next of linked) {
      visitedEdges.add(next.edgeId);
      if (visited.has(next.nodeId)) continue;
      visited.add(next.nodeId);
      queue.push(next.nodeId);
    }
  }

  return { nodeIds: visited, edgeIds: visitedEdges };
}
