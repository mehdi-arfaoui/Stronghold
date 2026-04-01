import { DescribeRegionsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

import {
  assumeAwsRole,
  buildAssumeRoleSessionName,
  buildAwsClientConfig,
  type DiscoveryCloudCredentials,
  type DiscoveryCredentials,
} from '@stronghold-dr/core';

import { AwsCliError, ConfigurationError } from '../errors/cli-error.js';

export interface ResolveAwsContextOptions {
  readonly profile?: string;
  readonly roleArn?: string;
  readonly externalId?: string;
  readonly accountName?: string;
  readonly explicitRegions?: readonly string[];
  readonly allRegions?: boolean;
}

export interface AwsExecutionContext {
  readonly credentials: DiscoveryCredentials;
  readonly regions: readonly string[];
  readonly authMode: string;
  readonly profile?: string;
  readonly roleArn?: string;
  readonly accountName?: string;
}

export interface BuildDiscoveryCredentialsOptions {
  readonly profile?: string;
  readonly region?: string;
  readonly includeEnvironmentCredentials?: boolean;
}

export async function resolveAwsExecutionContext(
  options: ResolveAwsContextOptions,
): Promise<AwsExecutionContext> {
  const bootstrapRegion = resolveBootstrapRegion(options.explicitRegions);
  const sourceCredentials =
    buildDiscoveryCredentials({
      profile: options.profile,
      region: bootstrapRegion,
      includeEnvironmentCredentials: !options.profile,
    }).aws ?? {};

  const resolvedCredentials = options.roleArn
    ? await resolveAssumedCredentials({
        roleArn: options.roleArn,
        externalId: options.externalId,
        sourceCredentials,
        region: bootstrapRegion,
      })
    : sourceCredentials;

  await verifyAwsCredentials(resolvedCredentials, { profile: options.profile });

  return {
    credentials: {
      aws: resolvedCredentials,
    },
    regions: await resolveAwsRegions({
      credentials: resolvedCredentials,
      explicitRegions: options.explicitRegions,
      allRegions: options.allRegions ?? false,
    }),
    authMode: resolveAuthMode(options.profile, options.roleArn),
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.roleArn ? { roleArn: options.roleArn } : {}),
    ...(options.accountName ? { accountName: options.accountName } : {}),
  };
}

export function resolveRegionFromEnvironment(): string | null {
  return process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION ?? null;
}

export async function resolveAwsRegions(options: {
  readonly credentials?: DiscoveryCloudCredentials;
  readonly explicitRegions?: readonly string[];
  readonly allRegions: boolean;
}): Promise<readonly string[]> {
  if (options.allRegions) {
    const region = options.credentials?.region ?? resolveRegionFromEnvironment() ?? 'us-east-1';
    const client = new EC2Client(
      buildAwsClientConfig({
        region,
        credentials: options.credentials ?? {},
        maxAttempts: 1,
      }),
    );
    try {
      const response = await client.send(
        new DescribeRegionsCommand({
          AllRegions: true,
          Filters: [
            {
              Name: 'opt-in-status',
              Values: ['opt-in-not-required', 'opted-in'],
            },
          ],
        }),
      );
      const regions = (response.Regions ?? [])
        .map((entry) => entry.RegionName)
        .filter((entry): entry is string => typeof entry === 'string')
        .sort();
      if (regions.length === 0) {
        throw new AwsCliError('No enabled AWS regions were found for this account.');
      }
      return regions;
    } catch (error) {
      throw mapAwsError(error, 'EC2');
    }
  }

  if (options.explicitRegions && options.explicitRegions.length > 0) {
    return options.explicitRegions;
  }

  const region = resolveRegionFromEnvironment();
  if (!region) {
    throw new ConfigurationError(`No AWS region specified.

Use --region, --all-regions, or set AWS_DEFAULT_REGION:
  stronghold scan --region eu-west-1
  stronghold scan --region eu-west-1,us-east-1
  stronghold scan --all-regions
  export AWS_DEFAULT_REGION=eu-west-1`);
  }

  return [region];
}

export function buildDiscoveryCredentials(
  options: BuildDiscoveryCredentialsOptions = {},
): DiscoveryCredentials {
  const region = options.region ?? resolveRegionFromEnvironment() ?? undefined;
  const includeEnvironmentCredentials = options.includeEnvironmentCredentials ?? true;

  return {
    aws: {
      ...(options.profile ? { profile: options.profile } : {}),
      ...(includeEnvironmentCredentials && process.env.AWS_ACCESS_KEY_ID
        ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID }
        : {}),
      ...(includeEnvironmentCredentials && process.env.AWS_SECRET_ACCESS_KEY
        ? { secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
        : {}),
      ...(includeEnvironmentCredentials && process.env.AWS_SESSION_TOKEN
        ? { sessionToken: process.env.AWS_SESSION_TOKEN }
        : {}),
      ...(region ? { region } : {}),
    },
  };
}

export async function verifyAwsCredentials(
  credentials: DiscoveryCloudCredentials = buildDiscoveryCredentials().aws ?? {},
  options: { readonly profile?: string } = {},
): Promise<void> {
  const region = credentials.region ?? resolveRegionFromEnvironment() ?? 'us-east-1';
  const client = new STSClient(
    buildAwsClientConfig({
      region,
      credentials,
      maxAttempts: 1,
    }),
  );

  try {
    await client.send(new GetCallerIdentityCommand({}));
  } catch (error) {
    throw mapCredentialError(error, options.profile);
  }
}

function resolveBootstrapRegion(explicitRegions?: readonly string[]): string {
  return explicitRegions?.[0] ?? resolveRegionFromEnvironment() ?? 'us-east-1';
}

async function resolveAssumedCredentials(options: {
  readonly roleArn: string;
  readonly externalId?: string;
  readonly sourceCredentials: DiscoveryCloudCredentials;
  readonly region: string;
}): Promise<DiscoveryCloudCredentials> {
  try {
    const assumed = await assumeAwsRole({
      region: options.region,
      roleArn: options.roleArn,
      externalId: options.externalId,
      sourceCredentials: options.sourceCredentials,
      sessionName: buildAssumeRoleSessionName(),
      maxAttempts: 1,
    });

    return {
      ...assumed,
      region: options.region,
    };
  } catch (error) {
    throw mapAssumeRoleError(error, options.roleArn);
  }
}

function resolveAuthMode(profile: string | undefined, roleArn: string | undefined): string {
  if (profile && roleArn) {
    return 'profile+assume-role';
  }
  if (roleArn) {
    return 'assume-role';
  }
  if (profile) {
    return 'profile';
  }
  return 'default-credential-chain';
}

function mapAssumeRoleError(error: unknown, roleArn: string): AwsCliError {
  const code = getAwsErrorCode(error);
  if (code === 'AccessDeniedException' || code === 'AccessDenied') {
    return new AwsCliError(`Unable to assume role ${roleArn}: access denied.`, error);
  }
  if (code === 'ExpiredTokenException' || code === 'ExpiredToken') {
    return new AwsCliError(
      `Unable to assume role ${roleArn}: source credentials expired.`,
      error,
    );
  }
  if (code === 'UnrecognizedClientException' || code === 'InvalidClientTokenId') {
    return new AwsCliError(
      `Unable to assume role ${roleArn}: source credentials are invalid.`,
      error,
    );
  }

  return new AwsCliError(
    `Unable to assume role ${roleArn}: ${resolveErrorMessage(error)}.`,
    error,
  );
}

function mapCredentialError(
  error: unknown,
  profile?: string,
): AwsCliError | ConfigurationError {
  const code = getAwsErrorCode(error);
  if (code === 'ExpiredTokenException' || code === 'ExpiredToken') {
    return new AwsCliError(
      'AWS credentials expired. Run aws sso login or refresh your credentials.',
      error,
    );
  }
  if (code === 'UnrecognizedClientException' || code === 'InvalidClientTokenId') {
    return new AwsCliError('Invalid AWS credentials. Check your access key and secret.', error);
  }
  if (code === 'AccessDeniedException' || code === 'AccessDenied') {
    return new AwsCliError(
      'Access denied for STS. Run stronghold iam-policy to see required permissions.',
      error,
    );
  }

  if (profile && isCredentialLoadingError(error)) {
    return new AwsCliError(
      `AWS profile '${profile}' could not be loaded or has no valid credentials. ` +
        `Run aws configure --profile ${profile} or aws sso login --profile ${profile}.`,
      error,
    );
  }

  return new ConfigurationError(`No AWS credentials found.

Stronghold uses the standard AWS credential chain.
Set up credentials using one of:

- Environment variables:
  export AWS_ACCESS_KEY_ID=...
  export AWS_SECRET_ACCESS_KEY=...

- AWS CLI profile:
  aws configure --profile production
  export AWS_PROFILE=production

- SSO:
  aws sso login --profile production

- Generate minimal IAM policy:
  stronghold iam-policy > stronghold-policy.json

Or try the demo mode (no credentials needed):
  stronghold demo`, error);
}

export function mapAwsError(error: unknown, service: string): AwsCliError {
  const code = getAwsErrorCode(error);
  if (code === 'AccessDeniedException' || code === 'AccessDenied') {
    return new AwsCliError(
      `Access denied for ${service}. Run stronghold iam-policy to see required permissions.`,
      error,
    );
  }
  if (code === 'ExpiredTokenException' || code === 'ExpiredToken') {
    return new AwsCliError(
      'AWS credentials expired. Run aws sso login or refresh your credentials.',
      error,
    );
  }
  if (code === 'UnrecognizedClientException' || code === 'InvalidClientTokenId') {
    return new AwsCliError('Invalid AWS credentials. Check your access key and secret.', error);
  }
  if (code.toLowerCase().includes('timeout')) {
    return new AwsCliError(
      `Connection timeout for ${service}. Check your network and AWS region availability.`,
      error,
    );
  }

  return new AwsCliError(
    `AWS error (${service}): ${resolveErrorMessage(error)}. Run with --verbose for details.`,
    error,
  );
}

function isCredentialLoadingError(error: unknown): boolean {
  const message = resolveErrorMessage(error).toLowerCase();
  return (
    message.includes('credential') ||
    message.includes('credentials') ||
    message.includes('profile')
  );
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getAwsErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const candidate = error as Record<string, unknown>;
  return String(candidate.name ?? candidate.Code ?? candidate.code ?? '');
}
