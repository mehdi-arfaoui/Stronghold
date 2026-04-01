import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { fromIni, fromTemporaryCredentials } from '@aws-sdk/credential-providers';

import type { DiscoveryCloudCredentials } from '../../types/discovery.js';
import type { ResolvedAwsCredentials } from './aws-client-factory.js';

export const DEFAULT_ASSUME_ROLE_SESSION_DURATION_SECONDS = 3_600;

type AwsCredentialProvider =
  | ResolvedAwsCredentials
  | ReturnType<typeof fromIni>
  | ReturnType<typeof fromTemporaryCredentials>;

export interface AssumeAwsRoleOptions {
  readonly region: string;
  readonly roleArn: string;
  readonly externalId?: string;
  readonly sourceCredentials?: DiscoveryCloudCredentials;
  readonly sessionName?: string;
  readonly durationSeconds?: number;
  readonly maxAttempts?: number;
}

export function resolveAwsSourceCredentials(
  credentials: DiscoveryCloudCredentials,
): AwsCredentialProvider | undefined {
  if (credentials.profile) {
    return fromIni({ profile: credentials.profile });
  }

  if (credentials.accessKeyId && credentials.secretAccessKey) {
    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
    };
  }

  return undefined;
}

export async function assumeAwsRole(options: AssumeAwsRoleOptions): Promise<ResolvedAwsCredentials> {
  const sourceCredentials = resolveAwsSourceCredentials(options.sourceCredentials ?? {});
  const client = new STSClient({
    region: options.region,
    ...(sourceCredentials ? { credentials: sourceCredentials } : {}),
    ...(typeof options.maxAttempts === 'number' ? { maxAttempts: options.maxAttempts } : {}),
  });

  const response = await client.send(
    new AssumeRoleCommand({
      RoleArn: options.roleArn,
      RoleSessionName: options.sessionName ?? buildAssumeRoleSessionName(),
      DurationSeconds:
        options.durationSeconds ?? DEFAULT_ASSUME_ROLE_SESSION_DURATION_SECONDS,
      ...(options.externalId ? { ExternalId: options.externalId } : {}),
    }),
  );

  if (
    !response.Credentials?.AccessKeyId ||
    !response.Credentials.SecretAccessKey ||
    !response.Credentials.SessionToken
  ) {
    throw new Error(`AssumeRole did not return temporary credentials for ${options.roleArn}.`);
  }

  return {
    accessKeyId: response.Credentials.AccessKeyId,
    secretAccessKey: response.Credentials.SecretAccessKey,
    sessionToken: response.Credentials.SessionToken,
  };
}

export function buildAssumeRoleSessionName(now = new Date()): string {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `stronghold-scan-${timestamp}`.slice(0, 64);
}
