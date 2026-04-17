import { DescribeRegionsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

import {
  AssumeRoleAuthProvider,
  AuthenticationError,
  CredentialExpiredError,
  NoAuthProviderAvailableError,
  ProfileAuthProvider,
  SsoAuthProvider,
  buildAwsClientConfig,
  createAccountContext,
  createScanContext,
  detectAuthProvider,
  extractRoleAccountId,
  getCallerIdentity,
  parseArn,
  type AuthProvider,
  type AuthTarget,
  type AuthTargetHint,
  type AwsCredentials,
  type DiscoveryCloudCredentials,
  type DiscoveryCredentials,
  type ScanContext,
} from '@stronghold-dr/core';

import { AwsCliError, ConfigurationError } from '../errors/cli-error.js';

const UNKNOWN_ACCOUNT_ID = '000000000000';

export interface ResolveAwsContextOptions {
  readonly profile?: string;
  readonly roleArn?: string;
  readonly externalId?: string;
  readonly accountName?: string;
  readonly accountId?: string;
  readonly partition?: string;
  readonly authHint?: AuthTargetHint;
  readonly explicitRegions?: readonly string[];
  readonly allRegions?: boolean;
}

export interface AwsExecutionContext {
  readonly scanContext: ScanContext;
  readonly regions: readonly string[];
  readonly authMode: string;
  readonly authDescription: string;
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
  try {
    const bootstrapRegion = resolveBootstrapRegion(options.explicitRegions);
    const authHint = resolveExplicitAuthHint(options);
    const partition = resolvePartition(options.partition, authHint, options.roleArn, bootstrapRegion);
    const targetAccountId = resolveTargetAccountId(options.accountId, authHint, options.roleArn);

    if (authHint?.kind === 'assume-role' && !targetAccountId) {
      throw new ConfigurationError(
        'Assume-role authentication requires a target accountId or a roleArn containing the target account.',
      );
    }

    const providers = createProviders(options.profile);
    const provisionalTarget: AuthTarget = {
      accountId: targetAccountId ?? UNKNOWN_ACCOUNT_ID,
      partition,
      region: bootstrapRegion,
      ...(authHint ? { hint: authHint } : {}),
    };

    const authProvider = await resolveAuthProviderForTarget(
      provisionalTarget,
      targetAccountId,
      authHint,
      providers,
    );
    const resolvedAccountId =
      targetAccountId ?? (await resolveCallerAccountId(authProvider, provisionalTarget, bootstrapRegion));

    const account = createAccountContext({
      accountId: resolvedAccountId,
      accountAlias: options.accountName ?? null,
      partition,
    });
    const scanContext = createScanContext({
      account,
      region: bootstrapRegion,
      authProvider,
      ...(authHint ? { authHint } : {}),
    });
    const bootstrapCredentials = await scanContext.getCredentials();
    const regions = await resolveAwsRegions({
      credentials: toDiscoveryCloudCredentials(bootstrapCredentials, bootstrapRegion),
      explicitRegions: options.explicitRegions,
      allRegions: options.allRegions ?? false,
    });

    return {
      scanContext,
      regions,
      authMode: resolveAuthMode(authProvider, options.profile),
      authDescription: authProvider.describeAuthMethod(scanContext.target),
      ...(options.profile ? { profile: options.profile } : {}),
      ...(resolveRoleArnMetadata(options.roleArn, authHint)
        ? { roleArn: resolveRoleArnMetadata(options.roleArn, authHint) }
        : {}),
      ...(options.accountName ? { accountName: options.accountName } : {}),
    };
  } catch (error) {
    throw mapAuthenticationResolutionError(error);
  }
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

function createProviders(defaultProfileName?: string): {
  readonly profile: ProfileAuthProvider;
  readonly assumeRole: AssumeRoleAuthProvider;
  readonly sso: SsoAuthProvider;
} {
  const profile = new ProfileAuthProvider({
    ...(defaultProfileName ? { defaultProfileName } : {}),
  });

  return {
    profile,
    assumeRole: new AssumeRoleAuthProvider({
      sourceProvider: profile,
    }),
    sso: new SsoAuthProvider(),
  };
}

async function resolveAuthProviderForTarget(
  provisionalTarget: AuthTarget,
  targetAccountId: string | undefined,
  authHint: AuthTargetHint | undefined,
  providers: {
    readonly profile: ProfileAuthProvider;
    readonly assumeRole: AssumeRoleAuthProvider;
    readonly sso: SsoAuthProvider;
  },
): Promise<AuthProvider> {
  if (authHint) {
    const explicitProvider = providerForHint(authHint, providers);
    if (targetAccountId) {
      const explicitTarget = {
        ...provisionalTarget,
        accountId: targetAccountId,
      };
      if (explicitProvider.kind === 'assume-role') {
        await explicitProvider.getCredentials(explicitTarget);
        return explicitProvider;
      }

      const canHandle = await explicitProvider.canHandle(explicitTarget);
      if (!canHandle) {
        throw new AuthenticationError(
          `Configured ${explicitProvider.kind} authentication could not access account ${targetAccountId}.`,
          explicitTarget,
          explicitProvider.kind,
        );
      }
    }
    return explicitProvider;
  }

  if (targetAccountId) {
    return detectAuthProvider(
      {
        ...provisionalTarget,
        accountId: targetAccountId,
      },
      [providers.profile, providers.assumeRole, providers.sso],
    );
  }

  return providers.profile;
}

function providerForHint(
  hint: AuthTargetHint,
  providers: {
    readonly profile: ProfileAuthProvider;
    readonly assumeRole: AssumeRoleAuthProvider;
    readonly sso: SsoAuthProvider;
  },
): AuthProvider {
  switch (hint.kind) {
    case 'profile':
      return providers.profile;
    case 'assume-role':
      return providers.assumeRole;
    case 'sso':
      return providers.sso;
    default:
      return providers.profile;
  }
}

function resolveExplicitAuthHint(options: ResolveAwsContextOptions): AuthTargetHint | undefined {
  if (options.authHint) {
    return options.authHint;
  }

  if (options.roleArn) {
    return {
      kind: 'assume-role',
      roleArn: options.roleArn,
      ...(options.externalId ? { externalId: options.externalId } : {}),
    };
  }

  if (options.profile) {
    return {
      kind: 'profile',
      profileName: options.profile,
    };
  }

  return undefined;
}

function resolveTargetAccountId(
  explicitAccountId: string | undefined,
  authHint: AuthTargetHint | undefined,
  roleArn: string | undefined,
): string | undefined {
  return (
    explicitAccountId ??
    (authHint?.kind === 'sso' ? authHint.accountId : undefined) ??
    (authHint?.kind === 'assume-role' && authHint.roleArn
      ? extractRoleAccountId(authHint.roleArn) ?? undefined
      : undefined) ??
    (roleArn ? extractRoleAccountId(roleArn) ?? undefined : undefined)
  );
}

function resolvePartition(
  explicitPartition: string | undefined,
  authHint: AuthTargetHint | undefined,
  roleArn: string | undefined,
  region: string,
): string {
  if (explicitPartition) {
    return explicitPartition;
  }

  const hintedRoleArn = authHint?.kind === 'assume-role' ? authHint.roleArn : undefined;
  const arn = hintedRoleArn ?? roleArn;
  if (arn) {
    try {
      return parseArn(arn).partition;
    } catch {
      return inferPartitionFromRegion(region);
    }
  }

  return inferPartitionFromRegion(region);
}

function inferPartitionFromRegion(region: string): string {
  const normalized = region.trim().toLowerCase();
  if (normalized.startsWith('cn-')) {
    return 'aws-cn';
  }
  if (normalized.startsWith('us-gov-')) {
    return 'aws-us-gov';
  }
  return 'aws';
}

async function resolveCallerAccountId(
  authProvider: AuthProvider,
  provisionalTarget: AuthTarget,
  region: string,
): Promise<string> {
  const credentials = await authProvider.getCredentials(provisionalTarget);
  const identity = await getCallerIdentity(toDiscoveryCloudCredentials(credentials, region));

  if (!identity) {
    throw new AwsCliError(
      'Unable to resolve AWS caller identity for the selected authentication method.',
    );
  }

  return identity.accountId;
}

function resolveBootstrapRegion(explicitRegions?: readonly string[]): string {
  return explicitRegions?.[0] ?? resolveRegionFromEnvironment() ?? 'us-east-1';
}

function resolveAuthMode(authProvider: AuthProvider, profile: string | undefined): string {
  if (authProvider.kind === 'assume-role' && profile) {
    return 'profile+assume-role';
  }

  return authProvider.kind;
}

function resolveRoleArnMetadata(
  explicitRoleArn: string | undefined,
  authHint: AuthTargetHint | undefined,
): string | undefined {
  if (explicitRoleArn) {
    return explicitRoleArn;
  }

  return authHint?.kind === 'assume-role' ? authHint.roleArn : undefined;
}

function toDiscoveryCloudCredentials(
  credentials: AwsCredentials,
  region: string,
): DiscoveryCloudCredentials {
  return {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
    region,
  };
}

function mapAuthenticationResolutionError(error: unknown): AwsCliError | ConfigurationError {
  if (error instanceof ConfigurationError) {
    return error;
  }

  if (error instanceof NoAuthProviderAvailableError) {
    return new AwsCliError(
      `No supported AWS authentication method was available for account ${error.target.accountId}.`,
      error,
    );
  }

  if (error instanceof CredentialExpiredError) {
    return new AwsCliError(
      'AWS credentials expired. Run aws sso login or refresh your credentials.',
      error,
    );
  }

  if (error instanceof AuthenticationError) {
    return new AwsCliError(error.message, error);
  }

  if (error instanceof AwsCliError) {
    return error;
  }

  return new AwsCliError(resolveErrorMessage(error), error);
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
