import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';

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

const DEFAULT_PROFILE_NAME = 'default';
const ENVIRONMENT_PROFILE_KEY = '__environment__';

export class ProfileAuthProvider implements AuthProvider {
  public readonly kind = 'profile' as const;
  private readonly cache: CredentialCache;
  private readonly accountIdCache = new Map<string, Promise<string>>();

  public constructor(private readonly options: {
    readonly defaultProfileName?: string;
    readonly cache?: CredentialCache;
    readonly fromIniFactory?: typeof fromIni;
  } = {}) {
    this.cache = options.cache ?? new CredentialCache();
  }

  public async getCredentials(target: AuthTarget): Promise<AwsCredentials> {
    const profileName = this.resolveProfileName(target);
    const cacheKey = `profile:${profileName ?? ENVIRONMENT_PROFILE_KEY}:${getAuthTargetCacheKey(target)}`;

    return this.cache.get(cacheKey, async () => {
      if (!profileName && hasEnvironmentCredentials()) {
        return readEnvironmentCredentials();
      }

      try {
        const provider = (this.options.fromIniFactory ?? fromIni)({
          ...(profileName ? { profile: profileName } : {}),
          clientConfig: {
            region: resolveStsRegion(target.partition, target.region),
          },
        });
        return normalizeAwsCredentials(await provider());
      } catch (error) {
        throw new AuthenticationError(
          `Unable to load AWS profile ${profileName ?? DEFAULT_PROFILE_NAME}.`,
          target,
          this.kind,
          error,
        );
      }
    });
  }

  public async canHandle(target: AuthTarget): Promise<boolean> {
    if (target.hint && target.hint.kind !== 'profile') {
      return false;
    }

    try {
      const credentials = await this.getCredentials(target);
      const resolvedAccountId = await this.resolveAccountId(
        target,
        credentials,
        this.resolveProfileName(target),
      );
      return resolvedAccountId === target.accountId;
    } catch {
      return false;
    }
  }

  public describeAuthMethod(target: AuthTarget): string {
    const profileName = this.resolveProfileName(target);
    if (!profileName && hasEnvironmentCredentials()) {
      return 'profile:environment';
    }

    return `profile:${profileName ?? DEFAULT_PROFILE_NAME}`;
  }

  private resolveProfileName(target: AuthTarget): string | undefined {
    if (target.hint?.kind === 'profile') {
      return normalizeOptionalString(target.hint.profileName);
    }

    return (
      normalizeOptionalString(this.options.defaultProfileName) ??
      normalizeOptionalString(process.env.AWS_PROFILE) ??
      (hasEnvironmentCredentials() ? undefined : DEFAULT_PROFILE_NAME)
    );
  }

  private async resolveAccountId(
    target: AuthTarget,
    credentials: AwsCredentials,
    profileName: string | undefined,
  ): Promise<string> {
    const cacheKey = `${profileName ?? ENVIRONMENT_PROFILE_KEY}:${target.partition}`;
    const cached = this.accountIdCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = this.fetchAccountId(target, credentials);
    this.accountIdCache.set(cacheKey, promise);
    return promise;
  }

  private async fetchAccountId(
    target: AuthTarget,
    credentials: AwsCredentials,
  ): Promise<string> {
    const client = new STSClient({
      region: resolveStsRegion(target.partition, target.region),
      credentials,
      maxAttempts: 1,
    });

    const response = await client.send(new GetCallerIdentityCommand({}));
    if (!response.Account) {
      throw new AuthenticationError(
        'AWS STS did not return an account identifier for the selected profile.',
        target,
        this.kind,
      );
    }

    return response.Account;
  }
}

function hasEnvironmentCredentials(): boolean {
  return Boolean(
    normalizeOptionalString(process.env.AWS_ACCESS_KEY_ID) &&
      normalizeOptionalString(process.env.AWS_SECRET_ACCESS_KEY),
  );
}

function readEnvironmentCredentials(): AwsCredentials {
  const accessKeyId = normalizeOptionalString(process.env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = normalizeOptionalString(process.env.AWS_SECRET_ACCESS_KEY);

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY.');
  }

  return {
    accessKeyId,
    secretAccessKey,
    ...(normalizeOptionalString(process.env.AWS_SESSION_TOKEN)
      ? { sessionToken: normalizeOptionalString(process.env.AWS_SESSION_TOKEN) }
      : {}),
  };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
