import type { GraphInstance } from '../../graph/graph-instance.js';
import { formatArn, tryParseArn } from '../../identity/index.js';
import type { CrossAccountEdge } from '../types.js';

type GraphRecord = Record<string, unknown>;

interface GraphNodeEntry {
  readonly arn: string;
  readonly attrs: GraphRecord;
}

export interface PolicyPrincipalEntry {
  readonly type: 'aws' | 'service' | 'canonical' | 'federated' | 'wildcard';
  readonly value: string;
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
const CROSS_ACCOUNT_CONDITION_KEYS = [
  'aws:principalaccount',
  'aws:sourceaccount',
  'kms:calleraccount',
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

export function parsePolicyDocument(
  value: unknown,
  cache?: Map<string, GraphRecord | null>,
): GraphRecord | null {
  if (isRecord(value)) {
    return value;
  }

  const raw = readString(value);
  if (!raw) {
    return null;
  }

  if (cache?.has(raw)) {
    return cache.get(raw) ?? null;
  }

  const parsed = tryParseJsonRecord(raw);
  cache?.set(raw, parsed);
  return parsed;
}

export function readPolicyStatements(
  value: unknown,
  cache?: Map<string, GraphRecord | null>,
): readonly GraphRecord[] {
  const parsed = parsePolicyDocument(value, cache);
  if (!parsed) {
    return [];
  }

  if (isRecord(parsed.Statement)) {
    return [parsed.Statement];
  }

  return readRecordArray(parsed.Statement);
}

export function readPolicyActions(value: unknown): readonly string[] {
  const direct = readString(value);
  if (direct) {
    return [direct];
  }

  return readStringArray(value);
}

export function policyActionsInclude(
  actions: readonly string[],
  targetAction: string,
): boolean {
  const normalizedTarget = normalizePolicyToken(targetAction);
  return actions.some((action) =>
    matchesPolicyAction(normalizePolicyToken(action), normalizedTarget),
  );
}

export function readPolicyPrincipalEntries(
  value: unknown,
): readonly PolicyPrincipalEntry[] {
  const entries: PolicyPrincipalEntry[] = [];
  const direct = readString(value);
  if (direct) {
    appendPrincipalEntry(entries, inferPrincipalType(direct), direct);
    return entries;
  }

  if (!isRecord(value)) {
    return entries;
  }

  appendPrincipalEntries(entries, 'aws', value.AWS);
  appendPrincipalEntries(entries, 'service', value.Service);
  appendPrincipalEntries(entries, 'canonical', value.CanonicalUser);
  appendPrincipalEntries(entries, 'federated', value.Federated);
  return entries;
}

export function readConditionEntries(
  value: unknown,
): ReadonlyMap<string, readonly string[]> {
  if (!isRecord(value)) {
    return new Map();
  }

  const entries = new Map<string, string[]>();
  for (const [outerKey, outerValue] of Object.entries(value)) {
    if (isRecord(outerValue)) {
      for (const [conditionKey, conditionValue] of Object.entries(outerValue)) {
        addConditionEntry(entries, conditionKey, conditionValue);
      }
      continue;
    }

    addConditionEntry(entries, outerKey, outerValue);
  }

  return entries;
}

export function readConditionKeys(value: unknown): readonly string[] {
  return [...readConditionEntries(value).keys()].sort();
}

export function readConditionValues(
  value: unknown,
  matchers: readonly string[],
): readonly string[] {
  const matcherSet = new Set(matchers.map((matcher) => matcher.toLowerCase()));
  const collected = new Set<string>();

  for (const [key, entries] of readConditionEntries(value).entries()) {
    if (!matcherSet.has(key.toLowerCase())) {
      continue;
    }

    for (const entry of entries) {
      collected.add(entry);
    }
  }

  return [...collected];
}

export function readConditionAccountIds(value: unknown): readonly string[] {
  const collected = new Set<string>();
  for (const entry of readConditionValues(value, CROSS_ACCOUNT_CONDITION_KEYS)) {
    const accountId = extractAccountIdFromPrincipal(entry);
    if (accountId) {
      collected.add(accountId);
    }
  }
  return [...collected];
}

export function buildIamRootArn(
  partition: string,
  accountId: string,
): string {
  return formatArn({
    raw: '',
    partition,
    service: 'iam',
    region: null,
    accountId,
    resourceType: null,
    resourceId: 'root',
  });
}

export function buildPrincipalArn(
  partition: string,
  principal: string,
): string | null {
  const normalized = principal.trim();
  if (!normalized) {
    return null;
  }

  const parsed = tryParseArn(normalized);
  if (parsed) {
    return parsed.raw;
  }

  return /^\d{12}$/.test(normalized)
    ? buildIamRootArn(partition, normalized)
    : null;
}

export function extractAccountIdFromPrincipal(value: string): string | null {
  const normalized = value.trim();
  if (/^\d{12}$/.test(normalized)) {
    return normalized;
  }

  return tryParseArn(normalized)?.accountId ?? null;
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

function tryParseJsonRecord(value: string): GraphRecord | null {
  const candidates = [value, safeDecodeURIComponent(value)].filter(
    (candidate, index, all): candidate is string =>
      candidate !== null && all.indexOf(candidate) === index,
  );

  for (const candidate of candidates) {
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function tryParseJsonCandidate(value: string): GraphRecord | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }

    if (typeof parsed === 'string') {
      const nested = JSON.parse(parsed) as unknown;
      return isRecord(nested) ? nested : null;
    }

    return null;
  } catch {
    return null;
  }
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded === value ? null : decoded;
  } catch {
    return null;
  }
}

function appendPrincipalEntries(
  target: PolicyPrincipalEntry[],
  type: Exclude<PolicyPrincipalEntry['type'], 'wildcard'>,
  value: unknown,
): void {
  const direct = readString(value);
  if (direct) {
    appendPrincipalEntry(target, direct === '*' ? 'wildcard' : type, direct);
    return;
  }

  for (const entry of readStringArray(value)) {
    appendPrincipalEntry(target, entry === '*' ? 'wildcard' : type, entry);
  }
}

function appendPrincipalEntry(
  target: PolicyPrincipalEntry[],
  type: PolicyPrincipalEntry['type'],
  value: string,
): void {
  const normalized = value.trim();
  if (!normalized) {
    return;
  }

  target.push({
    type,
    value: normalized,
  });
}

function inferPrincipalType(value: string): PolicyPrincipalEntry['type'] {
  if (value === '*') {
    return 'wildcard';
  }

  return value.endsWith('.amazonaws.com') ? 'service' : 'aws';
}

function addConditionEntry(
  target: Map<string, string[]>,
  key: string,
  value: unknown,
): void {
  const entries = readConditionStrings(value);
  if (entries.length === 0) {
    return;
  }

  const existing = target.get(key) ?? [];
  for (const entry of entries) {
    if (!existing.includes(entry)) {
      existing.push(entry);
    }
  }
  target.set(key, existing);
}

function readConditionStrings(value: unknown): readonly string[] {
  const direct = readString(value);
  if (direct) {
    return [direct];
  }

  return readStringArray(value);
}

function normalizePolicyToken(value: string): string {
  return value.trim().toLowerCase();
}

function matchesPolicyAction(
  action: string,
  targetAction: string,
): boolean {
  if (action === '*') {
    return true;
  }

  if (action.endsWith('*')) {
    return targetAction.startsWith(action.slice(0, -1));
  }

  return action === targetAction;
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
