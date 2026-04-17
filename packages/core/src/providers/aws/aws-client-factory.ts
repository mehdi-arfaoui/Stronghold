/**
 * Centralizes creation of AWS SDK clients with credential resolution.
 * Supports both static IAM keys and STS role assumption.
 */
import { EFSClient } from '@aws-sdk/client-efs';
import { Route53Client } from '@aws-sdk/client-route-53';
import { fromIni, fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import type { AwsCredentials } from '../../auth/index.js';
import { withScanContextRegion, type ScanContext } from '../../model/scan-context.js';
import type { DiscoveryCloudCredentials } from '../../types/discovery.js';
import { resolveAwsSourceCredentials } from './assume-role.js';

/** Resolved AWS credentials suitable for SDK client construction. */
export type ResolvedAwsCredentials = {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly expiration?: Date;
};

type AwsCredentialProvider =
  | ResolvedAwsCredentials
  | ReturnType<typeof fromIni>
  | ReturnType<typeof fromTemporaryCredentials>
  | (() => Promise<AwsCredentials>);

/**
 * Resolves AWS credentials from discovery config.
 * Returns a credential provider for role assumption, static credentials, or undefined.
 */
export function resolveAwsCredentials(
  credentials: DiscoveryCloudCredentials,
  region: string,
  sessionName = 'stronghold-discovery',
): AwsCredentialProvider | undefined {
  const sourceCredentials = resolveAwsSourceCredentials(credentials);

  if (credentials.roleArn) {
    return fromTemporaryCredentials({
      params: {
        RoleArn: credentials.roleArn,
        RoleSessionName: sessionName,
        ...(credentials.externalId ? { ExternalId: credentials.externalId } : {}),
      },
      ...(sourceCredentials ? { masterCredentials: sourceCredentials } : {}),
      clientConfig: { region },
    });
  }

  return sourceCredentials;
}

/** Options for creating an AWS SDK client. */
export interface AwsClientOptions {
  readonly region: string;
  readonly credentials?: DiscoveryCloudCredentials;
  readonly scanContext?: ScanContext;
  readonly sessionName?: string;
  readonly maxAttempts?: number;
  readonly abortSignal?: AbortSignal;
}

/**
 * Builds an AWS SDK client config object with resolved credentials.
 * Consumers pass this to any AWS SDK client constructor.
 */
export function buildAwsClientConfig(
  options: AwsClientOptions,
): { region: string; credentials?: AwsCredentialProvider; maxAttempts?: number } {
  const resolved = resolveAwsCredentialProvider(options);
  return {
    region: options.region,
    ...(resolved ? { credentials: resolved } : {}),
    ...(typeof options.maxAttempts === 'number' ? { maxAttempts: options.maxAttempts } : {}),
  };
}

/**
 * Creates an AWS SDK client of the given constructor type.
 * Uses `as never` cast because AWS SDK client constructors have overly
 * strict config types that are structurally compatible but nominally different.
 */
export function createAwsClient<TClient>(
  ClientConstructor: new (config: never) => TClient,
  options: AwsClientOptions,
): TClient {
  const config = buildAwsClientConfig(options);
  return new ClientConstructor(config as never);
}

export function getAwsCommandOptions(
  options: Pick<AwsClientOptions, 'abortSignal'>,
): { abortSignal?: AbortSignal } | undefined {
  return options.abortSignal ? { abortSignal: options.abortSignal } : undefined;
}

/** Creates a Route53 client pinned to the global endpoint region. */
export function createRoute53Client(options: AwsClientOptions): Route53Client {
  return createAwsClient(Route53Client, {
    ...options,
    region: 'us-east-1',
  });
}

/** Creates an EFS client for the current region. */
export function createEfsClient(options: AwsClientOptions): EFSClient {
  return createAwsClient(EFSClient, options);
}

function resolveAwsCredentialProvider(options: AwsClientOptions): AwsCredentialProvider | undefined {
  if (options.scanContext) {
    const context =
      options.scanContext.region === options.region
        ? options.scanContext
        : withScanContextRegion(options.scanContext, options.region);

    return async () => context.getCredentials();
  }

  return resolveAwsCredentials(options.credentials ?? {}, options.region, options.sessionName);
}
