import { createHash } from 'node:crypto';

import type { AccountContext } from '../identity/index.js';

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly expiration?: Date;
}

export interface AuthTarget {
  readonly accountId: string;
  readonly partition: string;
  readonly region: string;
  readonly hint?: AuthTargetHint;
}

export type AuthTargetHint =
  | { kind: 'profile'; profileName: string }
  | { kind: 'assume-role'; roleArn?: string; sessionName?: string; externalId?: string }
  | { kind: 'sso'; ssoProfileName: string; accountId: string; roleName: string };

export type AuthProviderKind = 'profile' | 'assume-role' | 'sso';

export interface AuthProvider {
  readonly kind: AuthProviderKind;
  getCredentials(target: AuthTarget): Promise<AwsCredentials>;
  canHandle(target: AuthTarget): Promise<boolean>;
  describeAuthMethod(target: AuthTarget): string;
}

export function buildAuthTarget(input: {
  readonly account: AccountContext;
  readonly region: string;
  readonly hint?: AuthTargetHint;
}): AuthTarget {
  return {
    accountId: input.account.accountId,
    partition: input.account.partition,
    region: input.region,
    ...(input.hint ? { hint: input.hint } : {}),
  };
}

export function withAuthTargetRegion(target: AuthTarget, region: string): AuthTarget {
  return {
    ...target,
    region,
  };
}

export function getAuthTargetCacheKey(target: AuthTarget): string {
  const hintHash = createHash('sha256')
    .update(stableStringify(target.hint ?? null))
    .digest('hex');

  return `${target.partition}:${target.accountId}:${target.region}:${hintHash}`;
}

export function normalizeAwsCredentials(input: {
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
  readonly expiration?: Date | string;
}): AwsCredentials {
  if (!input.accessKeyId || !input.secretAccessKey) {
    throw new Error('AWS credentials must include accessKeyId and secretAccessKey.');
  }

  const expiration = normalizeExpiration(input.expiration);
  return {
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}),
    ...(expiration ? { expiration } : {}),
  };
}

export function resolveStsRegion(partition: string, preferredRegion?: string): string {
  const normalizedPreferredRegion = preferredRegion?.trim();
  if (normalizedPreferredRegion) {
    return normalizedPreferredRegion;
  }

  switch (partition) {
    case 'aws-cn':
      return 'cn-north-1';
    case 'aws-us-gov':
      return 'us-gov-west-1';
    default:
      return 'us-east-1';
  }
}

function normalizeExpiration(expiration: Date | string | undefined): Date | undefined {
  if (!expiration) {
    return undefined;
  }

  if (expiration instanceof Date) {
    return expiration;
  }

  const parsed = new Date(expiration);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (!value || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);

  return `{${entries.join(',')}}`;
}
