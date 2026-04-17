import type { GraphInstance } from '../../graph/graph-instance.js';
import { formatArn, tryParseArn } from '../../identity/index.js';
import type { CrossAccountEdge } from '../types.js';

type GraphRecord = Record<string, unknown>;

interface GraphNodeEntry {
  readonly arn: string;
  readonly attrs: GraphRecord;
}

const PRODUCTION_TOKENS = ['prod', 'production', 'live', 'customer'] as const;
const NON_PRODUCTION_TOKENS = [
  'dev',
  'development',
  'test',
  'qa',
  'stage',
  'staging',
  'sandbox',
  'demo',
] as const;
const MONITORING_TOKENS = [
  'monitor',
  'monitoring',
  'metric',
  'metrics',
  'observability',
  'log',
  'logging',
  'trace',
  'tracing',
  'audit',
  'security',
] as const;
const DATA_SERVICE_TOKENS = [
  'rds',
  'aurora',
  'db',
  'database',
  'postgres',
  'mysql',
  'mariadb',
  'oracle',
  'sqlserver',
  'redis',
  'cache',
  'elasticache',
  'dynamodb',
  'kafka',
  'mq',
  'broker',
] as const;

export function isRecord(value: unknown): value is GraphRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== null);
}

export function readRecordArray(value: unknown): readonly GraphRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is GraphRecord => isRecord(entry));
}

export function getMetadata(attrs: GraphRecord): GraphRecord {
  return isRecord(attrs.metadata) ? attrs.metadata : {};
}

export function getNodeAccountId(attrs: GraphRecord): string | null {
  return readString(attrs.accountId) ?? readString(getMetadata(attrs).accountId);
}

export function getNodePartition(nodeArn: string, attrs: GraphRecord): string {
  return (
    readString(attrs.partition) ??
    readString(getMetadata(attrs).partition) ??
    tryParseArn(nodeArn)?.partition ??
    'aws'
  );
}

export function getNodeRegion(nodeArn: string, attrs: GraphRecord): string | null {
  return (
    readString(attrs.region) ??
    readString(getMetadata(attrs).region) ??
    tryParseArn(nodeArn)?.region ??
    null
  );
}

export function getNodeName(attrs: GraphRecord): string | null {
  return readString(attrs.name) ?? readString(getMetadata(attrs).displayName);
}

export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

export function nodeMatchesKinds(
  nodeArn: string,
  attrs: GraphRecord,
  expectedKinds: readonly string[],
): boolean {
  const expected = new Set(expectedKinds.map((kind) => normalizeIdentifier(kind)));
  const metadata = getMetadata(attrs);
  const parsedArn = tryParseArn(nodeArn);
  const candidates = [
    readString(metadata.sourceType),
    readString(attrs.resourceType),
    readString(metadata.resourceType),
    parsedArn?.resourceType ?? null,
  ]
    .filter((value): value is string => value !== null)
    .map((value) => normalizeIdentifier(value));

  return candidates.some((candidate) => expected.has(candidate));
}

export function collectNodes(
  graph: GraphInstance,
  expectedKinds: readonly string[],
): readonly GraphNodeEntry[] {
  const nodes: GraphNodeEntry[] = [];
  graph.forEachNode((nodeArn, attrs) => {
    if (nodeMatchesKinds(nodeArn, attrs, expectedKinds)) {
      nodes.push({ arn: nodeArn, attrs });
    }
  });
  return nodes;
}

export function buildLookupKey(accountId: string, resourceId: string): string {
  return `${accountId}:${normalizeIdentifier(resourceId)}`;
}

export function buildArn(params: {
  readonly partition: string;
  readonly service: string;
  readonly region?: string | null;
  readonly accountId?: string | null;
  readonly resourceType: string;
  readonly resourceId: string;
}): string {
  return formatArn({
    raw: '',
    partition: params.partition,
    service: params.service,
    region: params.region ?? null,
    accountId: params.accountId ?? null,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
  });
}

export function buildEc2Arn(
  partition: string,
  region: string | null,
  accountId: string,
  resourceType: string,
  resourceId: string,
): string {
  return buildArn({
    partition,
    service: 'ec2',
    region,
    accountId,
    resourceType,
    resourceId,
  });
}

export function buildRoute53HostedZoneArn(
  partition: string,
  hostedZoneId: string,
): string {
  return buildArn({
    partition,
    service: 'route53',
    region: null,
    accountId: null,
    resourceType: 'hostedzone',
    resourceId: hostedZoneId,
  });
}

export function buildCrossAccountCompleteness(
  graph: GraphInstance,
  edge: Omit<CrossAccountEdge, 'completeness' | 'missingAccountId'>,
): CrossAccountEdge {
  const sourceExists = graph.hasNode(edge.sourceArn);
  const targetExists = graph.hasNode(edge.targetArn);

  if (sourceExists && targetExists) {
    return {
      ...edge,
      completeness: 'complete',
    };
  }

  return {
    ...edge,
    completeness: 'partial',
    missingAccountId: sourceExists ? edge.targetAccountId : edge.sourceAccountId,
  };
}

export function getNodeTags(attrs: GraphRecord): Readonly<Record<string, string>> {
  const collected: Record<string, string> = {};
  const metadata = getMetadata(attrs);
  mergeStringRecord(collected, attrs.tags);
  mergeStringRecord(collected, metadata.awsTags);
  return collected;
}

export function detectEnvironmentLabel(
  values: readonly (string | null | undefined)[],
): 'production' | 'nonproduction' | 'unknown' {
  const haystack = values
    .filter((value): value is string => value !== null && value !== undefined)
    .map((value) => value.toLowerCase());

  if (containsKeyword(haystack, PRODUCTION_TOKENS)) {
    return 'production';
  }

  if (containsKeyword(haystack, NON_PRODUCTION_TOKENS)) {
    return 'nonproduction';
  }

  return 'unknown';
}

export function isMonitoringLike(
  values: readonly (string | null | undefined)[],
): boolean {
  const haystack = values
    .filter((value): value is string => value !== null && value !== undefined)
    .map((value) => value.toLowerCase());

  return containsKeyword(haystack, MONITORING_TOKENS);
}

export function isDataServiceLike(
  values: readonly (string | null | undefined)[],
): boolean {
  const haystack = values
    .filter((value): value is string => value !== null && value !== undefined)
    .map((value) => value.toLowerCase());

  return containsKeyword(haystack, DATA_SERVICE_TOKENS);
}

function containsKeyword(
  values: readonly string[],
  keywords: readonly string[],
): boolean {
  return values.some((value) =>
    keywords.some((keyword) => value.includes(keyword)),
  );
}

function mergeStringRecord(
  target: Record<string, string>,
  value: unknown,
): void {
  if (!isRecord(value)) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalized = readString(entry);
    if (normalized) {
      target[key] = normalized;
    }
  }
}
