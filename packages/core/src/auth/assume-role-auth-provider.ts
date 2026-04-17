import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

import { parseArn } from '../identity/index.js';
import { buildAssumeRoleSessionName } from '../providers/aws/assume-role.js';
import {
  getAuthTargetCacheKey,
  normalizeAwsCredentials,
  resolveStsRegion,
  type AuthProvider,
  type AuthTarget,
  type AwsCredentials,
} from './auth-provider.js';
import { CredentialCache } from './credential-cache.js';
import { AuthenticationError } from './errors.js';

export const DEFAULT_ASSUME_ROLE_NAME = 'OrganizationAccountAccessRole';

const MAX_ASSUME_ROLE_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 200;

export class AssumeRoleAuthProvider implements AuthProvider {
  public readonly kind = 'assume-role' as const;
  private readonly cache: CredentialCache;

  public constructor(private readonly options: {
    readonly sourceProvider: AuthProvider;
    readonly defaultSessionName?: string;
    readonly sessionDurationSeconds?: number;
    readonly defaultRoleName?: string;
    readonly cache?: CredentialCache;
  }) {
    this.cache = options.cache ?? new CredentialCache();
  }

  public async getCredentials(target: AuthTarget): Promise<AwsCredentials> {
    if (target.hint && target.hint.kind !== 'assume-role') {
      throw new AuthenticationError(
        'AssumeRoleAuthProvider cannot handle a non assume-role auth target.',
        target,
        this.kind,
      );
    }

    const roleArn = this.resolveRoleArn(target);
    const cacheKey = `assume-role:${roleArn}:${getAuthTargetCacheKey(target)}`;

    return this.cache.get(cacheKey, async () => {
      let sourceCredentials = await this.options.sourceProvider.getCredentials(target);
      let refreshedSourceCredentials = false;

      for (let attempt = 1; attempt <= MAX_ASSUME_ROLE_ATTEMPTS; attempt += 1) {
        try {
          const client = new STSClient({
            region: resolveStsRegion(target.partition, target.region),
            credentials: sourceCredentials,
            maxAttempts: 1,
          });

          const response = await client.send(
            new AssumeRoleCommand({
              RoleArn: roleArn,
              RoleSessionName: this.resolveSessionName(target),
              ...(this.resolveExternalId(target) ? { ExternalId: this.resolveExternalId(target) } : {}),
              ...(typeof this.options.sessionDurationSeconds === 'number'
                ? { DurationSeconds: this.options.sessionDurationSeconds }
                : {}),
            }),
          );

          if (
            !response.Credentials?.AccessKeyId ||
            !response.Credentials.SecretAccessKey ||
            !response.Credentials.SessionToken
          ) {
            throw new AuthenticationError(
              `AssumeRole did not return temporary credentials for ${roleArn}.`,
              target,
              this.kind,
            );
          }

          return normalizeAwsCredentials({
            accessKeyId: response.Credentials.AccessKeyId,
            secretAccessKey: response.Credentials.SecretAccessKey,
            sessionToken: response.Credentials.SessionToken,
            expiration: response.Credentials.Expiration,
          });
        } catch (error) {
          if (isAccessDeniedError(error)) {
            throw new AuthenticationError(
              `Unable to assume role ${roleArn}: access denied.`,
              target,
              this.kind,
              error,
            );
          }

          if (isSourceCredentialRefreshError(error) && !refreshedSourceCredentials) {
            sourceCredentials = await this.options.sourceProvider.getCredentials(target);
            refreshedSourceCredentials = true;
            continue;
          }

          if (attempt < MAX_ASSUME_ROLE_ATTEMPTS && isRetryableAssumeRoleError(error)) {
            await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
            continue;
          }

          throw new AuthenticationError(
            `Unable to assume role ${roleArn}: ${resolveErrorMessage(error)}.`,
            target,
            this.kind,
            error,
          );
        }
      }

      throw new AuthenticationError(
        `Unable to assume role ${roleArn}: retry attempts exhausted.`,
        target,
        this.kind,
      );
    });
  }

  public async canHandle(target: AuthTarget): Promise<boolean> {
    if (target.hint && target.hint.kind !== 'assume-role') {
      return false;
    }

    try {
      await this.getCredentials(target);
      return true;
    } catch {
      return false;
    }
  }

  public describeAuthMethod(target: AuthTarget): string {
    return `assume-role:${this.resolveRoleArn(target)}`;
  }

  private resolveRoleArn(target: AuthTarget): string {
    const hintedRoleArn =
      target.hint?.kind === 'assume-role' ? normalizeOptionalString(target.hint.roleArn) : undefined;
    if (hintedRoleArn) {
      return hintedRoleArn;
    }

    return `arn:${target.partition}:iam::${target.accountId}:role/${this.options.defaultRoleName ?? DEFAULT_ASSUME_ROLE_NAME}`;
  }

  private resolveSessionName(target: AuthTarget): string {
    const hintedName =
      target.hint?.kind === 'assume-role' ? normalizeOptionalString(target.hint.sessionName) : undefined;

    return hintedName ?? this.options.defaultSessionName ?? buildAssumeRoleSessionName();
  }

  private resolveExternalId(target: AuthTarget): string | undefined {
    if (target.hint?.kind !== 'assume-role') {
      return undefined;
    }

    return normalizeOptionalString(target.hint.externalId);
  }
}

function isAccessDeniedError(error: unknown): boolean {
  const code = getAwsErrorCode(error);
  return code === 'AccessDenied' || code === 'AccessDeniedException';
}

function isSourceCredentialRefreshError(error: unknown): boolean {
  const code = getAwsErrorCode(error);
  return (
    code === 'ExpiredToken' ||
    code === 'ExpiredTokenException' ||
    code === 'InvalidClientTokenId' ||
    code === 'UnrecognizedClientException'
  );
}

function isRetryableAssumeRoleError(error: unknown): boolean {
  const code = getAwsErrorCode(error).toLowerCase();
  const message = resolveErrorMessage(error).toLowerCase();

  return (
    code.includes('throttl') ||
    code.includes('toomanyrequests') ||
    code.includes('timeout') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('socket hang up')
  );
}

function getAwsErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const candidate = error as Record<string, unknown>;
  return String(candidate.name ?? candidate.Code ?? candidate.code ?? '');
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export function extractRoleAccountId(roleArn: string): string | null {
  try {
    return parseArn(roleArn).accountId;
  } catch {
    return null;
  }
}
