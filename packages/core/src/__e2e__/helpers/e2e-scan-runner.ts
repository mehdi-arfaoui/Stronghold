import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { DescribeRegionsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { MultiDirectedGraph } from 'graphology';

import {
  DEFAULT_ACCOUNT_SCAN_TIMEOUT_MS,
  MultiAccountOrchestrator,
  ProfileAuthProvider,
  AssumeRoleAuthProvider,
  SsoAuthProvider,
  allValidationRules,
  buildAwsClientConfig,
  buildAuthTarget,
  createAccountContext,
  createScanContext,
  detectAuthProvider,
  getCallerIdentity,
  parseStrongholdConfig,
  runValidation,
  scanAwsRegion,
  transformToScanResult,
  type AccountContext,
  type AccountScanResult,
  type AccountScanTarget,
  type AuthProvider,
  type AuthTargetHint,
  type AwsCredentials,
  type Finding,
  type GraphInstance,
  type MultiAccountScanResult,
  type Resource,
  type ScannerSkipReason,
  type StrongholdAwsAccountConfig,
  type StrongholdConfig,
  type ValidationEdge,
} from '../../index.js';

const execFileAsync = promisify(execFile);
const DEFAULT_E2E_REGION = 'eu-west-3';
const DEFAULT_SCANNER_TIMEOUT_MS = 60_000;

type GraphRecord = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;

interface ResolvedE2EAccount {
  readonly accountConfig: StrongholdAwsAccountConfig;
  readonly account: AccountContext;
  readonly authProvider: AuthProvider;
  readonly authHint?: AuthTargetHint;
  readonly regions: readonly string[];
  readonly scanTimeoutMs: number;
  readonly primaryRegion: string;
}

interface AwsCliSession {
  readonly env: NodeJS.ProcessEnv;
  readonly region: string;
  readonly accountId: string;
  readonly partition: string;
}

export interface E2ESingleAccountScanResult extends AccountScanResult {
  readonly resourceCount: number;
}

/**
 * Executes a real multi-account scan against AWS and returns the structured
 * orchestration result used by the cross-account detectors.
 */
export async function runE2EScan(configPath: string): Promise<MultiAccountScanResult> {
  const config = await loadStrongholdConfigFromFile(configPath);
  const configuredAccounts = config.aws?.accounts ?? [];
  if (configuredAccounts.length < 2) {
    throw new Error(`Expected at least 2 AWS accounts in ${configPath}.`);
  }

  const resolvedAccounts = await Promise.all(
    configuredAccounts.map((accountConfig) => resolveConfiguredAccount(accountConfig, config)),
  );
  const byAccountId = new Map(
    resolvedAccounts.map((resolvedAccount) => [resolvedAccount.account.accountId, resolvedAccount] as const),
  );
  const allAccountIds = resolvedAccounts.map((resolvedAccount) => resolvedAccount.account.accountId);

  const scanEngine = {
    scanAccount: async (target: AccountScanTarget): Promise<AccountScanResult> => {
      const resolvedAccount = byAccountId.get(target.account.accountId);
      if (!resolvedAccount) {
        throw new Error(`No resolved E2E account found for ${target.account.accountId}.`);
      }

      return scanResolvedAccount({
        resolvedAccount,
        allAccountIds,
      });
    },
  };

  const orchestrator = new MultiAccountOrchestrator({
    maxConcurrency: config.defaults?.accountConcurrency ?? resolvedAccounts.length,
    scanEngine,
  });

  return orchestrator.scan(
    resolvedAccounts.map((resolvedAccount) => ({
      account: resolvedAccount.account,
      regions: resolvedAccount.regions,
      authProvider: resolvedAccount.authProvider,
      ...(resolvedAccount.scanTimeoutMs
        ? { scanTimeoutMs: resolvedAccount.scanTimeoutMs }
        : {}),
    })),
  );
}

/**
 * Executes the single-account scan path used by the backward compatibility E2E.
 */
export async function runE2ESingleAccountScan(
  profile: string,
  region: string,
): Promise<E2ESingleAccountScanResult> {
  const authProvider = new ProfileAuthProvider({
    defaultProfileName: profile,
  });
  const account = await resolveProfileAccount(profile, region, authProvider);
  const resolvedAccount: ResolvedE2EAccount = {
    accountConfig: {
      accountId: account.accountId,
      alias: 'single-account',
      region,
      auth: {
        kind: 'profile',
        profileName: profile,
      },
    },
    account,
    authProvider,
    authHint: {
      kind: 'profile',
      profileName: profile,
    },
    regions: [region],
    scanTimeoutMs: DEFAULT_ACCOUNT_SCAN_TIMEOUT_MS,
    primaryRegion: region,
  };

  const result = await scanResolvedAccount({
    resolvedAccount,
    allAccountIds: [account.accountId],
  });

  return {
    ...result,
    resourceCount: result.resources.length,
  };
}

async function loadStrongholdConfigFromFile(filePath: string): Promise<StrongholdConfig> {
  const contents = await readFile(filePath, 'utf8');
  return parseStrongholdConfig(contents, filePath);
}

async function resolveConfiguredAccount(
  accountConfig: StrongholdAwsAccountConfig,
  config: StrongholdConfig,
): Promise<ResolvedE2EAccount> {
  const partition = accountConfig.partition ?? 'aws';
  const primaryRegion = resolvePrimaryRegion(accountConfig, config);
  const authHint = toAuthHint(accountConfig);
  const authProvider = await resolveAuthProvider(accountConfig, config, primaryRegion, partition, authHint);
  const account = createAccountContext({
    accountId: accountConfig.accountId,
    accountAlias: accountConfig.alias,
    partition,
  });
  const regions = await resolveConfiguredRegions({
    account,
    accountConfig,
    authHint,
    authProvider,
    config,
    primaryRegion,
  });

  return {
    accountConfig,
    account,
    authProvider,
    ...(authHint ? { authHint } : {}),
    regions,
    scanTimeoutMs:
      accountConfig.scanTimeoutMs ??
      config.defaults?.scanTimeoutMs ??
      DEFAULT_ACCOUNT_SCAN_TIMEOUT_MS,
    primaryRegion,
  };
}

async function resolveAuthProvider(
  accountConfig: StrongholdAwsAccountConfig,
  config: StrongholdConfig,
  region: string,
  partition: string,
  authHint: AuthTargetHint | undefined,
): Promise<AuthProvider> {
  const profileProvider = new ProfileAuthProvider({
    ...(config.aws?.profile ? { defaultProfileName: config.aws.profile } : {}),
  });
  const assumeRoleProvider = new AssumeRoleAuthProvider({
    sourceProvider: profileProvider,
  });
  const ssoProvider = new SsoAuthProvider();

  if (accountConfig.auth?.kind === 'profile') {
    return new ProfileAuthProvider({
      defaultProfileName: accountConfig.auth.profileName,
    });
  }

  if (accountConfig.auth?.kind === 'assume-role') {
    return new AssumeRoleAuthProvider({
      sourceProvider: profileProvider,
    });
  }

  if (accountConfig.auth?.kind === 'sso') {
    return ssoProvider;
  }

  return detectAuthProvider(
    {
      accountId: accountConfig.accountId,
      partition,
      region,
      ...(authHint ? { hint: authHint } : {}),
    },
    [profileProvider, assumeRoleProvider, ssoProvider],
  );
}

async function resolveConfiguredRegions(input: {
  readonly account: AccountContext;
  readonly accountConfig: StrongholdAwsAccountConfig;
  readonly authHint: AuthTargetHint | undefined;
  readonly authProvider: AuthProvider;
  readonly config: StrongholdConfig;
  readonly primaryRegion: string;
}): Promise<readonly string[]> {
  if (input.accountConfig.regions && input.accountConfig.regions.length > 0) {
    return input.accountConfig.regions;
  }

  if (input.accountConfig.region) {
    return [input.accountConfig.region];
  }

  if (input.accountConfig.allRegions === true || input.config.defaults?.allRegions === true) {
    return resolveAllRegions({
      account: input.account,
      authProvider: input.authProvider,
      authHint: input.authHint,
      region: input.primaryRegion,
    });
  }

  if (input.config.defaults?.regions && input.config.defaults.regions.length > 0) {
    return input.config.defaults.regions;
  }

  return [input.config.aws?.region ?? DEFAULT_E2E_REGION];
}

async function resolveAllRegions(input: {
  readonly account: AccountContext;
  readonly authProvider: AuthProvider;
  readonly authHint: AuthTargetHint | undefined;
  readonly region: string;
}): Promise<readonly string[]> {
  const target = buildAuthTarget({
    account: input.account,
    region: input.region,
    ...(input.authHint ? { hint: input.authHint } : {}),
  });
  const credentials = await input.authProvider.getCredentials(target);
  const client = new EC2Client(
    buildAwsClientConfig({
      region: input.region,
      credentials: toDiscoveryCredentials(credentials, input.region),
      maxAttempts: 1,
    }),
  );

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
    throw new Error(`No enabled AWS regions found for account ${input.account.accountId}.`);
  }

  return regions;
}

async function resolveProfileAccount(
  profile: string,
  region: string,
  authProvider: ProfileAuthProvider,
): Promise<AccountContext> {
  const placeholderAccount = createAccountContext({
    accountId: '000000000000',
  });
  const target = buildAuthTarget({
    account: placeholderAccount,
    region,
    hint: {
      kind: 'profile',
      profileName: profile,
    },
  });
  const credentials = await authProvider.getCredentials(target);
  const callerIdentity = await getCallerIdentity(toDiscoveryCredentials(credentials, region));
  if (!callerIdentity) {
    throw new Error(`Unable to resolve AWS caller identity for profile ${profile}.`);
  }

  return createAccountContext({
    accountId: callerIdentity.accountId,
    partition: inferPartition(region),
  });
}

async function scanResolvedAccount(input: {
  readonly resolvedAccount: ResolvedE2EAccount;
  readonly allAccountIds: readonly string[];
}): Promise<AccountScanResult> {
  const startedAt = Date.now();
  const { resolvedAccount } = input;
  const scanContext = createScanContext({
    account: resolvedAccount.account,
    region: resolvedAccount.primaryRegion,
    authProvider: resolvedAccount.authProvider,
    ...(resolvedAccount.authHint ? { authHint: resolvedAccount.authHint } : {}),
  });

  // Force authentication eagerly so partial-failure tests surface cleanly as
  // authentication errors before the scanner starts.
  await scanContext.getCredentials();

  const regionResults = [];
  for (const [index, region] of resolvedAccount.regions.entries()) {
    regionResults.push(
      await scanAwsRegion(
        {
          region,
          scanContext,
        },
        {
          includeGlobalServices: index === 0,
          scannerTimeoutMs: DEFAULT_SCANNER_TIMEOUT_MS,
        },
      ),
    );
  }

  const baseResources = regionResults.flatMap((regionResult) => regionResult.resources);
  const awsCliSession = await createAwsCliSession(scanContext);
  const augmentedResources = await collectE2EAugmentedResources({
    existingResources: baseResources,
    session: awsCliSession,
    account: resolvedAccount.account,
    allAccountIds: input.allAccountIds,
  });
  const resources = mergeDiscoveredResources(baseResources, augmentedResources);
  const transformed = transformToScanResult(resources, [], 'aws');
  const graph = buildGraph(transformed.nodes, transformed.edges);
  const findings = runValidation(
    transformed.nodes,
    transformed.edges as readonly ValidationEdge[],
    allValidationRules,
    undefined,
    {
      timestamp: new Date().toISOString(),
    },
  ).results as readonly Finding[];

  return {
    account: resolvedAccount.account,
    regions: resolvedAccount.regions,
    resources,
    findings,
    graph,
    scanDurationMs: Date.now() - startedAt,
    scannersExecuted: collectScannerNames(regionResults, 'success'),
    scannersSkipped: collectScannerSkipReasons(regionResults),
  };
}

async function createAwsCliSession(scanContext: ReturnType<typeof createScanContext>): Promise<AwsCliSession> {
  const credentials = await scanContext.getCredentials();
  return {
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: credentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
      ...(credentials.sessionToken ? { AWS_SESSION_TOKEN: credentials.sessionToken } : {}),
      AWS_REGION: scanContext.region,
      AWS_DEFAULT_REGION: scanContext.region,
    },
    region: scanContext.region,
    accountId: scanContext.account.accountId,
    partition: scanContext.account.partition,
  };
}

async function collectE2EAugmentedResources(input: {
  readonly existingResources: readonly Resource[];
  readonly session: AwsCliSession;
  readonly account: AccountContext;
  readonly allAccountIds: readonly string[];
}): Promise<readonly Resource[]> {
  const vpcPeeringResources = await collectVpcPeeringResources(input.session, input.account);
  const iamRoleResources = await collectIamRoleResources(input.session, input.account);
  const kmsResources = await collectKmsResources(input.session, input.account);
  const route53Resources = await collectRoute53Resources({
    existingResources: input.existingResources,
    session: input.session,
    account: input.account,
    allAccountIds: input.allAccountIds,
  });

  return [
    ...vpcPeeringResources,
    ...iamRoleResources,
    ...kmsResources,
    ...route53Resources,
  ];
}

async function collectVpcPeeringResources(
  session: AwsCliSession,
  account: AccountContext,
): Promise<readonly Resource[]> {
  const response = await runAwsCliJson(
    session,
    [
      'ec2',
      'describe-vpc-peering-connections',
      '--filters',
      'Name=status-code,Values=active',
      'Name=tag:Project,Values=stronghold-test',
    ],
    false,
  );
  const connections = readRecordArray(response.VpcPeeringConnections);
  const resources: Resource[] = [];

  for (const connection of connections) {
    const connectionId = readString(connection.VpcPeeringConnectionId);
    const requesterInfo = asRecord(connection.RequesterVpcInfo);
    const accepterInfo = asRecord(connection.AccepterVpcInfo);
    const requesterOwnerId = readString(requesterInfo?.OwnerId);
    const accepterOwnerId = readString(accepterInfo?.OwnerId);
    if (!connectionId || !requesterOwnerId || !accepterOwnerId || requesterOwnerId !== account.accountId) {
      continue;
    }

    const requesterVpcId = readString(requesterInfo?.VpcId);
    const accepterVpcId = readString(accepterInfo?.VpcId);
    if (!requesterVpcId || !accepterVpcId) {
      continue;
    }

    const routeTableIds = await collectRouteTableIdsForPeering(session, connectionId);
    resources.push(
      createAugmentedResource({
        arn: `arn:${session.partition}:ec2:${session.region}:${account.accountId}:vpc-peering-connection/${connectionId}`,
        account,
        name: connectionId,
        type: 'VPC_PEERING_CONNECTION',
        metadata: {
          peeringConnectionId: connectionId,
          requesterOwnerId,
          accepterOwnerId,
          requesterVpcId,
          accepterVpcId,
          requesterRegion: readString(requesterInfo?.Region) ?? session.region,
          accepterRegion: readString(accepterInfo?.Region) ?? session.region,
          status: readString(asRecord(connection.Status)?.Code) ?? 'active',
          routeTableIds,
        },
      }),
    );
  }

  return resources;
}

async function collectRouteTableIdsForPeering(
  session: AwsCliSession,
  peeringConnectionId: string,
): Promise<readonly string[]> {
  const response = await runAwsCliJson(
    session,
    [
      'ec2',
      'describe-route-tables',
      '--filters',
      `Name=route.vpc-peering-connection-id,Values=${peeringConnectionId}`,
    ],
    false,
  );

  return readRecordArray(response.RouteTables)
    .map((routeTable) => readString(routeTable.RouteTableId))
    .filter((routeTableId): routeTableId is string => routeTableId !== null);
}

async function collectIamRoleResources(
  session: AwsCliSession,
  account: AccountContext,
): Promise<readonly Resource[]> {
  const roleNames = [
    'StrongholdTestScannerRole',
    'StrongholdTestAppRole',
    'StrongholdTestCrossAccountRole',
    'StrongholdTestLambdaRole',
  ];
  const resources: Resource[] = [];

  for (const roleName of roleNames) {
    const roleResponse = await runAwsCliJsonSafe(
      session,
      ['iam', 'get-role', '--role-name', roleName],
      true,
    );
    const role = asRecord(roleResponse?.Role);
    const arn = readString(role?.Arn);
    if (!role || !arn) {
      continue;
    }

    resources.push(
      createAugmentedResource({
        arn,
        account,
        name: readString(role.RoleName) ?? roleName,
        type: 'IAM_ROLE',
        metadata: {
          roleName: readString(role.RoleName) ?? roleName,
          path: readString(role.Path),
          description: readString(role.Description),
          AssumeRolePolicyDocument: role.AssumeRolePolicyDocument,
        },
      }),
    );
  }

  return resources;
}

async function collectKmsResources(
  session: AwsCliSession,
  account: AccountContext,
): Promise<readonly Resource[]> {
  const describeResponse = await runAwsCliJsonSafe(
    session,
    ['kms', 'describe-key', '--key-id', 'alias/stronghold-test-prod'],
    false,
  );
  const keyMetadata = asRecord(describeResponse?.KeyMetadata);
  const arn = readString(keyMetadata?.Arn);
  const keyId = readString(keyMetadata?.KeyId);
  if (!keyMetadata || !arn || !keyId) {
    return [];
  }

  const [policyResponse, grantsResponse, rotationResponse] = await Promise.all([
    runAwsCliJsonSafe(
      session,
      ['kms', 'get-key-policy', '--key-id', keyId, '--policy-name', 'default'],
      false,
    ),
    runAwsCliJsonSafe(
      session,
      ['kms', 'list-grants', '--key-id', keyId],
      false,
    ),
    runAwsCliJsonSafe(
      session,
      ['kms', 'get-key-rotation-status', '--key-id', keyId],
      false,
    ),
  ]);

  return [
    createAugmentedResource({
      arn,
      account,
      name: keyId,
      type: 'KMS_KEY',
      metadata: {
        keyId,
        keyPolicy: policyResponse?.Policy,
        grants: readUnknownArray(grantsResponse?.Grants),
        keyRotationEnabled: readBoolean(rotationResponse?.KeyRotationEnabled),
      },
    }),
  ];
}

async function collectRoute53Resources(input: {
  readonly existingResources: readonly Resource[];
  readonly session: AwsCliSession;
  readonly account: AccountContext;
  readonly allAccountIds: readonly string[];
}): Promise<readonly Resource[]> {
  const hostedZone = input.existingResources.find(
    (resource) =>
      resource.service === 'route53' &&
      resource.resourceType === 'hostedzone' &&
      resource.metadata &&
      readString((resource.metadata as JsonRecord).name) === 'internal.stronghold-test.local',
  );
  if (!hostedZone) {
    return [];
  }

  const hostedZoneId = readString((hostedZone.metadata as JsonRecord).hostedZoneId) ?? hostedZone.resourceId;
  const response = await runAwsCliJsonSafe(
    input.session,
    ['route53', 'get-hosted-zone', '--id', hostedZoneId],
    true,
  );
  if (!response) {
    return [];
  }

  const associations = readRecordArray(response.VPCs).map((vpc) => {
    const vpcId = readString(vpc.VPCId);
    const vpcRegion = readString(vpc.VPCRegion) ?? input.session.region;
    const ownerAccountId = resolveVpcAssociationOwner({
      existingResources: input.existingResources,
      localAccountId: input.account.accountId,
      allAccountIds: input.allAccountIds,
      vpcId,
    });

    return {
      vpcId,
      vpcRegion,
      vpcOwnerId: ownerAccountId,
      accountId: ownerAccountId,
      vpcAssociationId: `${hostedZoneId}:${vpcId ?? 'unknown'}`,
    };
  }).filter((association) => association.vpcId !== null && association.vpcOwnerId !== null);

  return [
    createAugmentedResource({
      arn: hostedZone.arn,
      account: input.account,
      name: hostedZone.name,
      type: 'ROUTE53_HOSTED_ZONE',
      metadata: {
        ...(hostedZone.metadata ?? {}),
        hostedZoneId,
        name: 'internal.stronghold-test.local',
        isPrivate: true,
        vpcAssociations: associations,
      },
    }),
  ];
}

function resolveVpcAssociationOwner(input: {
  readonly existingResources: readonly Resource[];
  readonly localAccountId: string;
  readonly allAccountIds: readonly string[];
  readonly vpcId: string | null;
}): string | null {
  if (!input.vpcId) {
    return null;
  }

  const localVpc = input.existingResources.find(
    (resource) =>
      resource.service === 'ec2' &&
      resource.resourceType === 'vpc' &&
      resource.resourceId === input.vpcId,
  );
  if (localVpc) {
    return localVpc.account.accountId;
  }

  const otherAccounts = input.allAccountIds.filter((accountId) => accountId !== input.localAccountId);
  return otherAccounts.length === 1 ? otherAccounts[0] : null;
}

function mergeDiscoveredResources(
  baseResources: readonly Resource[],
  augmentedResources: readonly Resource[],
): readonly Resource[] {
  const byArn = new Map<string, Resource>();

  for (const resource of [...baseResources, ...augmentedResources]) {
    const existing = byArn.get(resource.arn);
    byArn.set(resource.arn, existing ? mergeResource(existing, resource) : resource);
  }

  return [...byArn.values()];
}

function mergeResource(base: Resource, incoming: Resource): Resource {
  return {
    ...base,
    name: preferString(base.name, incoming.name),
    ip: incoming.ip ?? base.ip,
    hostname: incoming.hostname ?? base.hostname,
    tags: mergeTags(base.tags, incoming.tags),
    metadata: {
      ...(base.metadata ?? {}),
      ...(incoming.metadata ?? {}),
    },
    openPorts: incoming.openPorts ?? base.openPorts,
  };
}

function mergeTags(
  base: Resource['tags'],
  incoming: Resource['tags'],
): Resource['tags'] {
  if (isStringRecord(base) || isStringRecord(incoming)) {
    return {
      ...(isStringRecord(base) ? base : {}),
      ...(isStringRecord(incoming) ? incoming : {}),
    };
  }

  if (Array.isArray(base) || Array.isArray(incoming)) {
    return [
      ...(Array.isArray(base) ? base : []),
      ...(Array.isArray(incoming) ? incoming : []),
    ];
  }

  return incoming ?? base ?? null;
}

function buildGraph(
  nodes: readonly { readonly id: string }[] & readonly JsonRecord[],
  edges: readonly ValidationEdge[] & readonly JsonRecord[],
): GraphInstance {
  const graph = new MultiDirectedGraph<GraphRecord, GraphRecord>();

  for (const node of nodes) {
    if (!graph.hasNode(node.id)) {
      graph.addNode(node.id, node);
    }
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      continue;
    }

    const edgeKey = `${edge.source}->${edge.target}:${edge.type}`;
    if (!graph.hasEdge(edgeKey)) {
      graph.addEdgeWithKey(edgeKey, edge.source, edge.target, edge as GraphRecord);
    }
  }

  return graph as unknown as GraphInstance;
}

function collectScannerNames(
  regionResults: readonly {
    readonly scannerResults: readonly {
      readonly scannerName: string;
      readonly finalStatus: 'success' | 'failed';
    }[];
  }[],
  status: 'success' | 'failed',
): readonly string[] {
  return Array.from(
    new Set(
      regionResults.flatMap((regionResult) =>
        regionResult.scannerResults
          .filter((scannerResult) => scannerResult.finalStatus === status)
          .map((scannerResult) => scannerResult.scannerName),
      ),
    ),
  ).sort();
}

function collectScannerSkipReasons(
  regionResults: readonly {
    readonly scannerResults: readonly {
      readonly scannerName: string;
      readonly region: string;
      readonly finalStatus: 'success' | 'failed';
      readonly failureType?: string;
    }[];
  }[],
): readonly ScannerSkipReason[] {
  return regionResults.flatMap((regionResult) =>
    regionResult.scannerResults
      .filter((scannerResult) => scannerResult.finalStatus === 'failed')
      .map((scannerResult) => ({
        scannerName: `${scannerResult.scannerName} (${scannerResult.region})`,
        reason: scannerResult.failureType ?? 'UnknownError',
      })),
  );
}

function createAugmentedResource(input: {
  readonly arn: string;
  readonly account: AccountContext;
  readonly name: string;
  readonly type: string;
  readonly metadata: Record<string, unknown>;
}): Resource {
  return {
    arn: input.arn,
    account: input.account,
    region: extractRegionFromArn(input.arn),
    service: extractArnComponent(input.arn, 'service'),
    resourceType: extractArnComponent(input.arn, 'resourceType'),
    resourceId: extractArnComponent(input.arn, 'resourceId'),
    source: 'aws',
    name: input.name,
    kind: 'infra',
    type: input.type,
    ip: null,
    hostname: null,
    tags: null,
    metadata: {
      ...input.metadata,
      sourceType: input.type,
      accountId: input.account.accountId,
      partition: input.account.partition,
      region: extractRegionFromArn(input.arn) ?? undefined,
      resourceId: extractArnComponent(input.arn, 'resourceId'),
    },
    openPorts: null,
  };
}

async function runAwsCliJson(
  session: AwsCliSession,
  args: readonly string[],
  globalService: boolean,
): Promise<JsonRecord> {
  const fullArgs = [
    ...args,
    ...(globalService ? [] : ['--region', session.region]),
    '--output',
    'json',
  ];
  const { stdout } = await execFileAsync('aws', fullArgs, {
    env: session.env,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });

  return parseJsonRecord(stdout, args.join(' '));
}

async function runAwsCliJsonSafe(
  session: AwsCliSession,
  args: readonly string[],
  globalService: boolean,
): Promise<JsonRecord | null> {
  try {
    return await runAwsCliJson(session, args, globalService);
  } catch {
    return null;
  }
}

function parseJsonRecord(value: string, commandLabel: string): JsonRecord {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`AWS CLI command did not return a JSON object: ${commandLabel}`);
  }

  return parsed as JsonRecord;
}

function toAuthHint(accountConfig: StrongholdAwsAccountConfig): AuthTargetHint | undefined {
  if (!accountConfig.auth) {
    return undefined;
  }

  switch (accountConfig.auth.kind) {
    case 'profile':
      return {
        kind: 'profile',
        profileName: accountConfig.auth.profileName,
      };
    case 'assume-role':
      return {
        kind: 'assume-role',
        ...(accountConfig.auth.roleArn ? { roleArn: accountConfig.auth.roleArn } : {}),
        ...(accountConfig.auth.sessionName ? { sessionName: accountConfig.auth.sessionName } : {}),
        ...(accountConfig.auth.externalId ? { externalId: accountConfig.auth.externalId } : {}),
      };
    case 'sso':
      return {
        kind: 'sso',
        ssoProfileName: accountConfig.auth.ssoProfileName,
        accountId: accountConfig.accountId,
        roleName: accountConfig.auth.roleName,
      };
    default:
      return undefined;
  }
}

function resolvePrimaryRegion(
  accountConfig: StrongholdAwsAccountConfig,
  config: StrongholdConfig,
): string {
  return (
    accountConfig.region ??
    accountConfig.regions?.[0] ??
    config.aws?.region ??
    config.defaults?.regions?.[0] ??
    DEFAULT_E2E_REGION
  );
}

function toDiscoveryCredentials(credentials: AwsCredentials, region: string): {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly region: string;
} {
  return {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
    region,
  };
}

function inferPartition(region: string): string {
  const normalized = region.trim().toLowerCase();
  if (normalized.startsWith('cn-')) {
    return 'aws-cn';
  }
  if (normalized.startsWith('us-gov-')) {
    return 'aws-us-gov';
  }
  return 'aws';
}

function preferString(base: string, incoming: string): string {
  return incoming.trim().length > 0 ? incoming : base;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readRecordArray(value: unknown): readonly JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is JsonRecord => asRecord(entry) !== null);
}

function readUnknownArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}

function extractRegionFromArn(arn: string): string | null {
  const segments = arn.split(':');
  return segments.length > 3 && segments[3] ? segments[3] : null;
}

function extractArnComponent(
  arn: string,
  component: 'service' | 'resourceType' | 'resourceId',
): string | null {
  const segments = arn.split(':');
  const service = segments[2] ?? null;
  const resource = segments.slice(5).join(':');
  const [resourceType, ...resourceIdParts] = resource.split('/');
  const resourceId = resourceIdParts.join('/');

  if (component === 'service') {
    return service;
  }

  if (!resource) {
    return null;
  }

  if (component === 'resourceType') {
    return resourceId ? resourceType : null;
  }

  return resourceId || resourceType;
}
