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
  /application[_-]?gateway/i,
  /front[_-]?door/i,
  /network[_-]?security[_-]?group/i,
];

const COMPUTE_INFRA_SOURCE_PATTERNS = [
  /\basg\b/i,
  /auto[_-]?scaling/i,
  /launch[_-]?template/i,
  /vmss/i,
  /virtual[_-]?machine[_-]?scale[_-]?set/i,
  /managed[_-]?instance[_-]?group/i,
  /instance[_-]?group[_-]?manager/i,
];

const EXPLICIT_SERVICE_SOURCE_PATTERNS = [
  /elasticache/i,
  /\bcache\b/i,
  /dynamodb/i,
  /\bs3\b/i,
  /\bbucket\b/i,
  /\bsqs\b/i,
  /\bqueue\b/i,
  /\bsns\b/i,
  /\btopic\b/i,
  /sql/i,
  /postgres/i,
  /mysql/i,
  /cosmos/i,
  /redis/i,
  /blob/i,
  /storage[_-]?account/i,
  /service[_-]?bus/i,
  /event[_-]?grid/i,
  /event[_-]?hub/i,
  /cloud[_-]?sql/i,
  /memorystore/i,
  /cloud[_-]?storage/i,
  /pub[_-]?sub/i,
  /cloud[_-]?tasks/i,
  /firestore/i,
  /bigtable/i,
  /functions?/i,
  /cloud[_-]?run/i,
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
  const sourceType = readSourceType(node);
  if (sourceType && matchesAnyPattern(sourceType, EXPLICIT_SERVICE_SOURCE_PATTERNS)) {
    return true;
  }
  return !isPureInfrastructureNode(node);
}
