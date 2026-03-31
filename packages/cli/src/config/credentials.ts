import { DescribeRegionsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

import type { DiscoveryCredentials } from '@stronghold-dr/core';

import { AwsCliError, ConfigurationError } from '../errors/cli-error.js';

export interface ResolveAwsContextOptions {
  readonly profile?: string;
  readonly explicitRegions?: readonly string[];
  readonly allRegions?: boolean;
}

export interface AwsExecutionContext {
  readonly credentials: DiscoveryCredentials;
  readonly regions: readonly string[];
  readonly profile?: string;
}

export async function resolveAwsExecutionContext(
  options: ResolveAwsContextOptions,
): Promise<AwsExecutionContext> {
  applyAwsProfile(options.profile);
  await verifyAwsCredentials();

  return {
    credentials: buildDiscoveryCredentials(),
    regions: await resolveAwsRegions({
      explicitRegions: options.explicitRegions,
      allRegions: options.allRegions ?? false,
    }),
    ...(options.profile ? { profile: options.profile } : {}),
  };
}

export function resolveRegionFromEnvironment(): string | null {
  return process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION ?? null;
}

export async function resolveAwsRegions(options: {
  readonly explicitRegions?: readonly string[];
  readonly allRegions: boolean;
}): Promise<readonly string[]> {
  if (options.allRegions) {
    const client = new EC2Client({ region: 'us-east-1' });
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
        .map((region) => region.RegionName)
        .filter((region): region is string => typeof region === 'string')
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
    throw new ConfigurationError(`❌ No AWS region specified.

   Use --region, --all-regions, or set AWS_DEFAULT_REGION:
     stronghold scan --region eu-west-1
     stronghold scan --region eu-west-1,us-east-1
     stronghold scan --all-regions
     export AWS_DEFAULT_REGION=eu-west-1`);
  }

  return [region];
}

export function buildDiscoveryCredentials(): DiscoveryCredentials {
  return {
    aws: {
      ...(process.env.AWS_ACCESS_KEY_ID ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID } : {}),
      ...(process.env.AWS_SECRET_ACCESS_KEY
        ? { secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
        : {}),
      ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
      ...(resolveRegionFromEnvironment() ? { region: resolveRegionFromEnvironment() ?? undefined } : {}),
    },
  };
}

export async function verifyAwsCredentials(): Promise<void> {
  const region = resolveRegionFromEnvironment() ?? 'us-east-1';
  const client = new STSClient({ region });

  try {
    await client.send(new GetCallerIdentityCommand({}));
  } catch (error) {
    throw mapCredentialError(error);
  }
}

function applyAwsProfile(profile?: string): void {
  if (!profile) {
    return;
  }
  process.env.AWS_PROFILE = profile;
}

function mapCredentialError(error: unknown): AwsCliError | ConfigurationError {
  const code = getAwsErrorCode(error);
  if (code === 'ExpiredTokenException' || code === 'ExpiredToken') {
    return new AwsCliError(
      '❌ AWS credentials expired. Run \'aws sso login\' or refresh your credentials.',
      error,
    );
  }
  if (code === 'UnrecognizedClientException' || code === 'InvalidClientTokenId') {
    return new AwsCliError('❌ Invalid AWS credentials. Check your access key and secret.', error);
  }
  if (code === 'AccessDeniedException' || code === 'AccessDenied') {
    return new AwsCliError(
      '❌ Access denied for STS. Run \'stronghold iam-policy\' to see required permissions.',
      error,
    );
  }

  return new ConfigurationError(`❌ No AWS credentials found.

   Stronghold uses the standard AWS credential chain.
   Set up credentials using one of:

   • Environment variables:
     export AWS_ACCESS_KEY_ID=...
     export AWS_SECRET_ACCESS_KEY=...

   • AWS CLI profile:
     aws configure --profile production
     export AWS_PROFILE=production

   • SSO:
     aws sso login --profile production

   • Generate minimal IAM policy:
     stronghold iam-policy > stronghold-policy.json

   Or try the demo mode (no credentials needed):
     stronghold demo`, error);
}

export function mapAwsError(error: unknown, service: string): AwsCliError {
  const code = getAwsErrorCode(error);
  if (code === 'AccessDeniedException' || code === 'AccessDenied') {
    return new AwsCliError(
      `❌ Access denied for ${service}. Run 'stronghold iam-policy' to see required permissions.`,
      error,
    );
  }
  if (code === 'ExpiredTokenException' || code === 'ExpiredToken') {
    return new AwsCliError(
      '❌ AWS credentials expired. Run \'aws sso login\' or refresh your credentials.',
      error,
    );
  }
  if (code === 'UnrecognizedClientException' || code === 'InvalidClientTokenId') {
    return new AwsCliError('❌ Invalid AWS credentials. Check your access key and secret.', error);
  }
  if (code.toLowerCase().includes('timeout')) {
    return new AwsCliError(
      `❌ Connection timeout for ${service}. Check your network and AWS region availability.`,
      error,
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new AwsCliError(`❌ AWS error (${service}): ${message}. Run with --verbose for details.`, error);
}

function getAwsErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const candidate = error as Record<string, unknown>;
  return String(candidate.name ?? candidate.Code ?? candidate.code ?? '');
}
