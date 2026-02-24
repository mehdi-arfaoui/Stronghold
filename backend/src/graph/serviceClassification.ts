import { NodeType, type InfraNodeAttrs } from './types.js';

const NETWORK_INFRA_TYPES = new Set<string>([
  NodeType.VPC,
  NodeType.SUBNET,
  NodeType.REGION,
  NodeType.AVAILABILITY_ZONE,
  NodeType.DATA_CENTER,
  NodeType.NETWORK_DEVICE,
  NodeType.FIREWALL,
]);

const NETWORK_INFRA_SOURCE_PATTERNS = [
  /security[_-]?group/i,
  /route[_-]?table/i,
  /internet[_-]?gateway/i,
  /nat[_-]?gateway/i,
  /network[_-]?acl/i,
  /\bnacl\b/i,
  /transit[_-]?gateway/i,
  /vpc[_-]?endpoint/i,
  /network[_-]?interface/i,
  /eni/i,
];

const COMPUTE_INFRA_SOURCE_PATTERNS = [
  /\basg\b/i,
  /auto[_-]?scaling/i,
  /launch[_-]?template/i,
];

function readSourceType(node: InfraNodeAttrs): string {
  const metadata = node.metadata;
  if (!metadata || typeof metadata !== 'object') return '';

  const raw = (metadata as Record<string, unknown>).sourceType;
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

function matchesAnyPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function isPureInfrastructureNode(node: InfraNodeAttrs): boolean {
  if (NETWORK_INFRA_TYPES.has(node.type)) return true;

  const sourceType = readSourceType(node);
  if (!sourceType) return false;
  if (matchesAnyPattern(sourceType, NETWORK_INFRA_SOURCE_PATTERNS)) return true;
  if (matchesAnyPattern(sourceType, COMPUTE_INFRA_SOURCE_PATTERNS)) return true;
  return false;
}

export function isAnalyzableServiceNode(node: InfraNodeAttrs): boolean {
  return !isPureInfrastructureNode(node);
}

