import { createHash } from 'node:crypto';

import { redact } from '../redaction/redaction-engine.js';

export interface FixtureMeta {
  readonly capturedAt: string;
  readonly strongholdVersion: string;
  readonly redacted: true;
  readonly region?: string;
  readonly regions?: readonly string[];
}

export interface FixtureLeak {
  readonly kind:
    | 'arn'
    | 'accountId'
    | 'ip'
    | 'email'
    | 'internalHostname'
    | 'bucketName'
    | 'kmsKeyIdentifier';
  readonly path: string;
  readonly value: string;
}

interface StringContext {
  readonly key?: string;
}

const RAW_ARN_PATTERN = /arn:aws:[^\s"'`]+/gi;
const RAW_ACCOUNT_ID_PATTERN = /\b\d{12}\b/g;
const PRIVATE_IP_PATTERN =
  /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g;
const PUBLIC_IP_PATTERN =
  /\b(?!(?:10|127)\.)(?!192\.168\.)(?!172\.(?:1[6-9]|2\d|3[01])\.)(?:\d{1,3}\.){3}\d{1,3}\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SAFE_EMAIL_PATTERN = /\bsh-user-[a-f0-9]+@example\.invalid\b/gi;
const INTERNAL_HOST_PATTERN =
  /\b(?:ip-\d{1,3}(?:-\d{1,3}){3}|[a-z0-9][a-z0-9-]{0,62})(?:\.[a-z0-9-]+)*\.(?:internal|corp|local|lan|private|intra|localdomain)\b/gi;
const EC2_INTERNAL_HOST_PATTERN =
  /\b(?:[a-z0-9-]+\.)*ec2\.internal\b/gi;
const SAFE_INTERNAL_HOST_PATTERN =
  /\b(?:https?:\/\/)?sh-host-[a-f0-9]+\.example\.internal(?:\/[^\s"'`]*)?\b/gi;
const KMS_UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const KMS_MULTIREGION_PATTERN = /\bmrk-[0-9a-f]{32}\b/gi;
const KMS_KEY_PATTERN = /\b[0-9a-f]{32}\b/gi;
const KMS_UUID_EXACT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KMS_MULTIREGION_EXACT_PATTERN = /^mrk-[0-9a-f]{32}$/i;
const KMS_KEY_EXACT_PATTERN = /^[0-9a-f]{32}$/i;
const BUCKET_NAME_PATTERN =
  /^(?!\d+\.\d+\.\d+\.\d+$)(?!.*\.\.)(?:[a-z0-9][a-z0-9.-]{1,61}[a-z0-9])$/;

export function sanitizeFixtureValue<TValue>(value: TValue): TValue {
  const normalized = normalizeJsonValue(value);
  return sanitizeValue(normalized, {}) as TValue;
}

export function detectFixtureLeaks(value: unknown): readonly FixtureLeak[] {
  const normalized = normalizeJsonValue(value);
  const leaks: FixtureLeak[] = [];
  collectLeaks(normalized, '$', leaks);
  return leaks;
}

function sanitizeValue(value: unknown, context: StringContext): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value, context);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, {}));
  }

  if (!isRecord(value)) {
    return value;
  }

  const clone: Record<string, unknown> = {};
  Object.entries(value).forEach(([key, entry]) => {
    clone[key] = sanitizeValue(entry, { key });
  });
  sanitizeStructuredRecord(clone);
  return clone;
}

function sanitizeString(value: string, context: StringContext): string {
  let sanitized = value.replace(RAW_ARN_PATTERN, (match) => sanitizeArn(match));
  const preservedArns = sanitized.match(RAW_ARN_PATTERN) ?? [];
  const preservedEmails = sanitized.match(SAFE_EMAIL_PATTERN) ?? [];
  const preservedHosts = sanitized.match(SAFE_INTERNAL_HOST_PATTERN) ?? [];
  sanitized = redact(sanitized, {
    level: 'partial',
    ...(preservedArns.length + preservedEmails.length + preservedHosts.length > 0
      ? {
          preserve: [...preservedArns, ...preservedEmails, ...preservedHosts],
        }
      : {}),
  });
  sanitized = sanitized.replace(EMAIL_PATTERN, (match) => sanitizeEmail(match));
  sanitized = sanitized.replace(INTERNAL_HOST_PATTERN, (match) =>
    isSanitizedInternalHostname(match) ? match : sanitizeInternalHostname(match),
  );
  sanitized = sanitized.replace(EC2_INTERNAL_HOST_PATTERN, (match) =>
    isSanitizedInternalHostname(match) ? match : sanitizeInternalHostname(match),
  );
  sanitized = sanitized.replace(KMS_UUID_PATTERN, (match) => sanitizeKmsIdentifier(match));
  sanitized = sanitized.replace(KMS_MULTIREGION_PATTERN, (match) => sanitizeKmsIdentifier(match));
  sanitized = sanitized.replace(KMS_KEY_PATTERN, (match) =>
    isMaskedIdentifier(match) ? match : sanitizeKmsIdentifier(match),
  );
  sanitized = sanitized.replace(RAW_ACCOUNT_ID_PATTERN, (match) => maskAccountId(match));
  sanitized = sanitized.replace(PRIVATE_IP_PATTERN, () => '***.***.***.***');
  sanitized = sanitized.replace(PUBLIC_IP_PATTERN, () => '***.***.***.***');

  if (isBucketKey(context.key) && looksLikeBucketName(sanitized) && !isMaskedBucketName(sanitized)) {
    sanitized = sanitizeBucketName(sanitized);
  }

  if (isKmsKey(context.key) && looksLikeKmsIdentifier(sanitized)) {
    sanitized = sanitizeKmsValue(sanitized);
  }

  return sanitized;
}

function sanitizeStructuredRecord(record: Record<string, unknown>): void {
  if (isS3LikeRecord(record)) {
    applyStringField(record, 'name', (value) => sanitizeBucketName(value));
    applyStringField(record, 'id', (value) => sanitizeS3Identifier(value));
    applyStringField(record, 'arn', (value) => sanitizeS3Identifier(value));
    applyStringField(record, 'externalId', (value) => sanitizeS3Identifier(value));
    applyStringField(record, 'bucketName', (value) => sanitizeBucketName(value));
    applyStringField(record, 'bucketArn', (value) => sanitizeArn(value));
  }

  Object.keys(record)
    .filter((key) => isKmsKey(key))
    .forEach((key) => {
      applyStringField(record, key, (value) => sanitizeKmsValue(value));
    });
}

function sanitizeArn(arn: string): string {
  const segments = arn.split(':');
  if (segments.length < 6) {
    return arn;
  }

  const [
    prefix = 'arn',
    partition = 'aws',
    service = '',
    region = '',
    accountId = '',
    ...resourceParts
  ] = segments;
  const resource = resourceParts.join(':');
  const sanitizedAccount = accountId ? maskAccountId(accountId) : '';
  let sanitizedResource = resource;

  if (service === 's3') {
    sanitizedResource = sanitizeS3ArnResource(resource);
  } else if (service === 'kms') {
    sanitizedResource = sanitizeKmsArnResource(resource);
  } else if (!isMaskedIdentifier(resource)) {
    sanitizedResource = sanitizeGenericArnResource(resource, service);
  }

  return [prefix, partition, service, region, sanitizedAccount, sanitizedResource].join(':');
}

function sanitizeS3ArnResource(resource: string): string {
  const [bucketName, ...rest] = resource.split('/');
  const sanitizedBucket = sanitizeBucketName(bucketName ?? resource);
  if (rest.length === 0) {
    return sanitizedBucket;
  }
  return `${sanitizedBucket}/${stableMarker('object', rest.join('/'))}`;
}

function sanitizeKmsArnResource(resource: string): string {
  if (resource.startsWith('key/')) {
    const keyId = resource.slice(4);
    return `key/${isMaskedIdentifier(keyId) ? keyId : stableMarker('kms', keyId)}`;
  }
  if (resource.startsWith('alias/')) {
    const alias = resource.slice(6);
    return `alias/${isMaskedIdentifier(alias) ? alias : stableMarker('kms-alias', alias)}`;
  }
  return sanitizeGenericArnResource(resource, 'kms');
}

function sanitizeGenericArnResource(resource: string, service: string): string {
  if (isMaskedIdentifier(resource)) {
    return resource;
  }

  const delimiterIndex = resource.search(/[:/]/);
  if (delimiterIndex === -1) {
    return stableMarker(service.toLowerCase(), resource);
  }

  const prefix = resource.slice(0, delimiterIndex + 1);
  return `${prefix}${stableMarker(service.toLowerCase(), resource)}`;
}

function sanitizeBucketName(value: string): string {
  if (isMaskedBucketName(value)) {
    return value;
  }
  return stableMarker('bucket', value);
}

function sanitizeS3Identifier(value: string): string {
  if (value.startsWith('arn:aws:s3:::')) {
    return sanitizeArn(value);
  }
  return sanitizeBucketName(value);
}

function sanitizeKmsValue(value: string): string {
  if (value.startsWith('arn:aws:kms:')) {
    return sanitizeArn(value);
  }
  return sanitizeKmsIdentifier(value);
}

function sanitizeKmsIdentifier(value: string): string {
  if (value.startsWith('alias/')) {
    return `alias/${stableMarker('kms-alias', value.slice(6))}`;
  }
  return stableMarker('kms', value);
}

function sanitizeEmail(value: string): string {
  if (isSanitizedEmail(value)) {
    return value;
  }
  return `${stableMarker('user', value)}@example.invalid`;
}

function sanitizeInternalHostname(value: string): string {
  if (isSanitizedInternalHostname(value)) {
    return value;
  }
  return `${stableMarker('host', value)}.example.internal`;
}

function stableMarker(kind: string, value: string): string {
  return `sh-${kind}-${stableHash(value)}`;
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function maskAccountId(accountId: string): string {
  if (accountId.includes('*')) {
    return accountId;
  }
  if (/^\d{12}$/.test(accountId)) {
    return `****${accountId.slice(-4)}`;
  }
  return `****${stableHash(accountId).slice(0, 4)}`;
}

function collectLeaks(value: unknown, path: string, leaks: FixtureLeak[]): void {
  if (typeof value === 'string') {
    findStringLeaks(value, path, leaks);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectLeaks(entry, `${path}[${index}]`, leaks);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  findStructuredLeaks(value, path, leaks);
  Object.entries(value).forEach(([key, entry]) => {
    collectLeaks(entry, `${path}.${key}`, leaks);
  });
}

function findStringLeaks(value: string, path: string, leaks: FixtureLeak[]): void {
  appendUniqueMatches(
    leaks,
    'arn',
    path,
    value.match(RAW_ARN_PATTERN)?.filter((match) => !isSafeArn(match)) ?? [],
  );
  appendUniqueMatches(
    leaks,
    'accountId',
    path,
    value.match(RAW_ACCOUNT_ID_PATTERN) ?? [],
  );
  appendUniqueMatches(
    leaks,
    'ip',
    path,
    [
      ...(value.match(PRIVATE_IP_PATTERN) ?? []),
      ...(value.match(PUBLIC_IP_PATTERN) ?? []),
    ],
  );
  appendUniqueMatches(
    leaks,
    'email',
    path,
    value.match(EMAIL_PATTERN)?.filter((match) => !isSanitizedEmail(match)) ?? [],
  );
  appendUniqueMatches(
    leaks,
    'internalHostname',
    path,
    [
      ...(value.match(INTERNAL_HOST_PATTERN)?.filter((match) => !isSanitizedInternalHostname(match)) ?? []),
      ...(value.match(EC2_INTERNAL_HOST_PATTERN)?.filter((match) => !isSanitizedInternalHostname(match)) ?? []),
    ],
  );
}

function findStructuredLeaks(
  record: Record<string, unknown>,
  path: string,
  leaks: FixtureLeak[],
): void {
  Object.entries(record).forEach(([key, value]) => {
    if (typeof value !== 'string') {
      return;
    }

    if (isBucketKey(key) && looksLikeBucketName(value) && !isMaskedBucketName(value)) {
      leaks.push({
        kind: 'bucketName',
        path: `${path}.${key}`,
        value,
      });
    }

    if (isKmsKey(key) && looksLikeKmsIdentifier(value) && !isMaskedKmsValue(value)) {
      leaks.push({
        kind: 'kmsKeyIdentifier',
        path: `${path}.${key}`,
        value,
      });
    }
  });
}

function appendUniqueMatches(
  leaks: FixtureLeak[],
  kind: FixtureLeak['kind'],
  path: string,
  values: readonly string[],
): void {
  const unique = new Set(values.filter((value) => value.length > 0));
  unique.forEach((value) => {
    leaks.push({ kind, path, value });
  });
}

function isSafeArn(arn: string): boolean {
  const segments = arn.split(':');
  if (segments.length < 6) {
    return false;
  }

  const service = segments[2] ?? '';
  const accountId = segments[4] ?? '';
  const resource = segments.slice(5).join(':');
  if (accountId && /^\d{12}$/.test(accountId)) {
    return false;
  }

  if (service === 's3') {
    return resource.includes('sh-bucket-');
  }
  if (service === 'kms') {
    return resource.includes('sh-kms-') || resource.includes('sh-kms-alias-');
  }
  return resource.includes('sh-') || resource.includes('****');
}

function isS3LikeRecord(record: Record<string, unknown>): boolean {
  const metadata = isRecord(record.metadata) ? record.metadata : null;
  const recordType = readString(record.type);
  const sourceType = metadata ? readString(metadata.sourceType) : readString(record.sourceType);
  const resourceArn = readString(record.arn) ?? readString(record.externalId) ?? readString(record.id);

  return (
    recordType === 'OBJECT_STORAGE' ||
    sourceType === 'S3_BUCKET' ||
    typeof record.bucketName === 'string' ||
    typeof record.bucketArn === 'string' ||
    resourceArn?.startsWith('arn:aws:s3:::') === true
  );
}

function isBucketKey(key: string | undefined): boolean {
  return typeof key === 'string' && key.toLowerCase().includes('bucket');
}

function isKmsKey(key: string | undefined): boolean {
  if (typeof key !== 'string') {
    return false;
  }
  const normalized = key.toLowerCase();
  return normalized.includes('kms') || normalized.includes('keyid') || normalized.includes('cmk');
}

function looksLikeBucketName(value: string): boolean {
  if (value.startsWith('arn:aws:s3:::')) {
    return !value.includes('sh-bucket-');
  }
  return BUCKET_NAME_PATTERN.test(value);
}

function looksLikeKmsIdentifier(value: string): boolean {
  if (value.startsWith('arn:aws:kms:')) {
    return true;
  }
  if (value.startsWith('alias/')) {
    return !value.includes('sh-kms-alias-');
  }
  return (
    KMS_UUID_EXACT_PATTERN.test(value) ||
    KMS_MULTIREGION_EXACT_PATTERN.test(value) ||
    KMS_KEY_EXACT_PATTERN.test(value)
  );
}

function isMaskedBucketName(value: string): boolean {
  return value.includes('sh-bucket-') || value.includes('****');
}

function isMaskedKmsValue(value: string): boolean {
  return value.includes('sh-kms-') || value.includes('sh-kms-alias-') || value.includes('****');
}

function isMaskedIdentifier(value: string): boolean {
  return value.includes('****') || value.includes('sh-');
}

function isSanitizedEmail(value: string): boolean {
  return value.endsWith('@example.invalid') && value.startsWith('sh-user-');
}

function isSanitizedInternalHostname(value: string): boolean {
  return value.includes('.example.internal') && value.startsWith('sh-host-');
}

function applyStringField(
  record: Record<string, unknown>,
  key: string,
  transform: (value: string) => string,
): void {
  if (typeof record[key] !== 'string') {
    return;
  }
  record[key] = transform(record[key]);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeJsonValue<TValue>(value: TValue): TValue {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as TValue;
}
