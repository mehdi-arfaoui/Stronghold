/**
 * Scans Amazon ECS/Fargate clusters, services, task definitions, tasks, and capacity providers.
 */

import {
  DescribeCapacityProvidersCommand,
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  ListTasksCommand,
  type CapacityProvider,
  type CapacityProviderStrategyItem,
  type Cluster,
  type ContainerDefinition,
  type DescribeTaskDefinitionResponse,
  type Service,
  type Task,
  type TaskDefinition,
  type Volume,
} from '@aws-sdk/client-ecs';
import { createAccountContext, tryParseArn, type AccountContext } from '../../../identity/index.js';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { EdgeType } from '../../../types/infrastructure.js';
import {
  computeRetryDelayMs,
  getAwsFailureType,
  isAwsThrottlingError,
  type AwsRetryPolicy,
} from '../aws-retry-utils.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import {
  createAccountContextResolver,
  createResource,
  paginateAws,
  sleep,
} from '../scan-utils.js';
import { getNameTag, tagsArrayToMap } from '../tag-utils.js';

const ECS_DESCRIBE_RETRY_POLICY: AwsRetryPolicy = {
  maxAttempts: 4,
  initialBackoffMs: 100,
  backoffMultiplier: 2,
  maxJitterMs: 0,
};

const ECR_IMAGE_PATTERN =
  /^(?<accountId>\d{12})\.dkr\.ecr\.(?<region>[a-z0-9-]+)\.(?<domain>amazonaws\.com(?:\.cn)?)\/(?<repository>[^:@]+)(?:(?<separator>[:@])(?<reference>.+))?$/;

interface EcsDependencyEdgeSummary {
  readonly target: string;
  readonly type: string;
  readonly relationship: string;
  readonly metadata?: Record<string, unknown>;
}

interface TaskDefinitionCacheEntry {
  readonly taskDefinition: TaskDefinition | null;
  readonly tags: Record<string, string>;
}

interface EcrImageReference {
  readonly image: string;
  readonly repositoryArn: string;
  readonly repositoryUri: string;
  readonly repositoryName: string;
  readonly accountId: string;
  readonly region: string;
  readonly imageReference: string | null;
}

interface SecretReferenceSummary {
  readonly containerName: string | null;
  readonly name: string;
  readonly valueFrom: string;
  readonly targetArn: string | null;
  readonly provider: 'secretsmanager' | 'ssm' | 'other';
}

function chunk<TValue>(values: readonly TValue[], size: number): TValue[][] {
  const chunks: TValue[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function compactStrings(values: readonly (string | undefined | null)[]): string[] {
  return values
    .map((value) => value?.trim() ?? '')
    .filter((value): value is string => value.length > 0);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function nullableString(value: string | undefined): string | null {
  return value?.trim() || null;
}

function extractLastArnSegment(arn: string | undefined): string | null {
  if (!arn) return null;
  const segments = arn.split('/');
  return segments[segments.length - 1]?.trim() || null;
}

function extractTaskId(taskArn: string | undefined): string {
  return extractLastArnSegment(taskArn) ?? 'task';
}

function buildClusterArn(
  clusterName: string,
  region: string,
  accountContext: AccountContext,
): string {
  return `arn:${accountContext.partition}:ecs:${region}:${accountContext.accountId}:cluster/${clusterName}`;
}

function buildServiceArn(
  clusterName: string,
  serviceName: string,
  region: string,
  accountContext: AccountContext,
): string {
  return `arn:${accountContext.partition}:ecs:${region}:${accountContext.accountId}:service/${clusterName}/${serviceName}`;
}

function buildTaskArn(
  clusterName: string,
  taskId: string,
  region: string,
  accountContext: AccountContext,
): string {
  return `arn:${accountContext.partition}:ecs:${region}:${accountContext.accountId}:task/${clusterName}/${taskId}`;
}

function buildTaskDefinitionArn(
  family: string,
  revision: number,
  region: string,
  accountContext: AccountContext,
): string {
  return `arn:${accountContext.partition}:ecs:${region}:${accountContext.accountId}:task-definition/${family}:${revision}`;
}

function buildCapacityProviderArn(
  capacityProviderName: string,
  region: string,
  accountContext: AccountContext,
): string {
  return `arn:${accountContext.partition}:ecs:${region}:${accountContext.accountId}:capacity-provider/${capacityProviderName}`;
}

function accountContextFromArn(arn: string | undefined | null): AccountContext | null {
  if (!arn) return null;
  const parsed = tryParseArn(arn);
  if (!parsed?.accountId) return null;
  return createAccountContext({
    accountId: parsed.accountId,
    partition: parsed.partition,
  });
}

function buildEfsArn(
  fileSystemId: string,
  region: string,
  accountContext: AccountContext,
): string {
  if (fileSystemId.startsWith('arn:')) return fileSystemId;
  return `arn:${accountContext.partition}:elasticfilesystem:${region}:${accountContext.accountId}:file-system/${fileSystemId}`;
}

function buildCloudWatchLogGroupArn(
  logGroupName: string,
  region: string,
  accountContext: AccountContext,
): string {
  return `arn:${accountContext.partition}:logs:${region}:${accountContext.accountId}:log-group:${logGroupName}`;
}

function buildS3BucketArn(bucketName: string, partition = 'aws'): string {
  return `arn:${partition}:s3:::${bucketName}`;
}

function normalizeS3BucketArn(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const segments = trimmed.split(':');
  if (segments[0] === 'arn' && segments[2] === 's3') {
    const partition = segments[1]?.trim() || 'aws';
    const bucketName = segments.slice(5).join(':').split('/')[0]?.trim();
    return bucketName ? buildS3BucketArn(bucketName, partition) : null;
  }
  return null;
}

function normalizeKmsKeyArn(
  keyId: string | undefined,
  region: string,
  accountContext: AccountContext,
): string | null {
  const trimmed = keyId?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('arn:')) return trimmed;
  const resource = trimmed.startsWith('alias/') ? trimmed : `key/${trimmed}`;
  return `arn:${accountContext.partition}:kms:${region}:${accountContext.accountId}:${resource}`;
}

function normalizeSecretTargetArn(valueFrom: string): SecretReferenceSummary['targetArn'] {
  const trimmed = valueFrom.trim();
  if (!trimmed.startsWith('arn:')) return null;
  const segments = trimmed.split(':');
  const service = segments[2];
  if (service === 'secretsmanager' && segments[5] === 'secret' && segments[6]) {
    return segments.slice(0, 7).join(':');
  }
  if (service === 'ssm') {
    return trimmed;
  }
  return trimmed;
}

function classifySecretProvider(valueFrom: string): SecretReferenceSummary['provider'] {
  const trimmed = valueFrom.trim().toLowerCase();
  if (trimmed.startsWith('arn:aws:secretsmanager:')) return 'secretsmanager';
  if (trimmed.startsWith('arn:aws-us-gov:secretsmanager:')) return 'secretsmanager';
  if (trimmed.startsWith('arn:aws-cn:secretsmanager:')) return 'secretsmanager';
  if (trimmed.startsWith('arn:aws:ssm:')) return 'ssm';
  if (trimmed.startsWith('arn:aws-us-gov:ssm:')) return 'ssm';
  if (trimmed.startsWith('arn:aws-cn:ssm:')) return 'ssm';
  return 'other';
}

function parseEcrImage(image: string, accountContext: AccountContext): EcrImageReference | null {
  const match = ECR_IMAGE_PATTERN.exec(image.trim());
  if (!match?.groups) return null;

  const accountId = match.groups.accountId;
  const region = match.groups.region;
  const domain = match.groups.domain;
  const repositoryName = match.groups.repository;
  if (!accountId || !region || !domain || !repositoryName) return null;

  const partition = domain.endsWith('.cn') || region.startsWith('cn-')
    ? 'aws-cn'
    : accountContext.partition;
  return {
    image,
    repositoryArn: `arn:${partition}:ecr:${region}:${accountId}:repository/${repositoryName}`,
    repositoryUri: `${accountId}.dkr.ecr.${region}.${domain}/${repositoryName}`,
    repositoryName,
    accountId,
    region,
    imageReference: match.groups.reference ?? null,
  };
}

async function sendWithRetry<TValue>(action: () => Promise<TValue>): Promise<TValue> {
  let retryCount = 0;

  for (let attempt = 1; attempt <= ECS_DESCRIBE_RETRY_POLICY.maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (isAwsThrottlingError(error) && attempt < ECS_DESCRIBE_RETRY_POLICY.maxAttempts) {
        retryCount += 1;
        await sleep(computeRetryDelayMs(retryCount, ECS_DESCRIBE_RETRY_POLICY, () => 0));
        continue;
      }
      throw error;
    }
  }

  throw new Error('ECS retry loop exhausted unexpectedly.');
}

async function describeClusters(
  ecs: ECSClient,
  options: AwsClientOptions,
  clusterArns: readonly string[],
): Promise<readonly Cluster[]> {
  const clusters: Cluster[] = [];

  for (const batch of chunk(clusterArns, 100)) {
    const response = await sendWithRetry(() =>
      ecs.send(
        new DescribeClustersCommand({
          clusters: batch,
          include: ['CONFIGURATIONS', 'SETTINGS', 'STATISTICS', 'TAGS'],
        }),
        getAwsCommandOptions(options),
      ),
    );
    clusters.push(...(response.clusters ?? []));
  }

  return clusters;
}

async function describeServices(
  ecs: ECSClient,
  options: AwsClientOptions,
  clusterArn: string,
  serviceArns: readonly string[],
): Promise<readonly Service[]> {
  const services: Service[] = [];

  for (const batch of chunk(serviceArns, 10)) {
    const response = await sendWithRetry(() =>
      ecs.send(
        new DescribeServicesCommand({
          cluster: clusterArn,
          services: batch,
          include: ['TAGS'],
        }),
        getAwsCommandOptions(options),
      ),
    );
    services.push(...(response.services ?? []));
  }

  return services;
}

async function describeRunningServiceTasks(
  ecs: ECSClient,
  options: AwsClientOptions,
  clusterArn: string,
  serviceName: string,
): Promise<readonly Task[]> {
  const taskArns = await paginateAws(
    (nextToken) =>
      sendWithRetry(() =>
        ecs.send(
          new ListTasksCommand({
            cluster: clusterArn,
            serviceName,
            desiredStatus: 'RUNNING',
            nextToken,
          }),
          getAwsCommandOptions(options),
        ),
      ),
    (response) => response.taskArns,
    (response) => response.nextToken,
  );

  const tasks: Task[] = [];
  for (const batch of chunk(taskArns, 100)) {
    const response = await sendWithRetry(() =>
      ecs.send(
        new DescribeTasksCommand({
          cluster: clusterArn,
          tasks: batch,
          include: ['TAGS'],
        }),
        getAwsCommandOptions(options),
      ),
    );
    tasks.push(...(response.tasks ?? []));
  }

  return tasks;
}

async function describeTaskDefinitionCached(
  ecs: ECSClient,
  options: AwsClientOptions,
  taskDefinitionArn: string,
  cache: Map<string, TaskDefinitionCacheEntry>,
  warnings: string[],
): Promise<TaskDefinitionCacheEntry> {
  const cached = cache.get(taskDefinitionArn);
  if (cached) return cached;

  try {
    const response: DescribeTaskDefinitionResponse = await sendWithRetry(() =>
      ecs.send(
        new DescribeTaskDefinitionCommand({
          taskDefinition: taskDefinitionArn,
          include: ['TAGS'],
        }),
        getAwsCommandOptions(options),
      ),
    );
    const entry: TaskDefinitionCacheEntry = {
      taskDefinition: response.taskDefinition ?? null,
      tags: tagsArrayToMap(response.tags),
    };
    cache.set(taskDefinitionArn, entry);
    return entry;
  } catch (error) {
    warnings.push(
      `ECS task definition unavailable for ${taskDefinitionArn} in ${options.region} (${getAwsFailureType(error)}).`,
    );
    const entry: TaskDefinitionCacheEntry = { taskDefinition: null, tags: {} };
    cache.set(taskDefinitionArn, entry);
    return entry;
  }
}

async function describeCapacityProviders(
  ecs: ECSClient,
  options: AwsClientOptions,
  capacityProviderNames: readonly string[],
  warnings: string[],
): Promise<readonly CapacityProvider[]> {
  const providers: CapacityProvider[] = [];

  for (const batch of chunk(uniqueStrings(capacityProviderNames), 100)) {
    if (batch.length === 0) continue;
    try {
      const response = await sendWithRetry(() =>
        ecs.send(
          new DescribeCapacityProvidersCommand({
            capacityProviders: batch,
            include: ['TAGS'],
          }),
          getAwsCommandOptions(options),
        ),
      );
      providers.push(...(response.capacityProviders ?? []));
    } catch (error) {
      warnings.push(
        `ECS capacity providers unavailable in ${options.region} (${getAwsFailureType(error)}).`,
      );
    }
  }

  return providers;
}

function summarizeCapacityProviderStrategy(
  strategy: readonly CapacityProviderStrategyItem[] | undefined,
): Array<Record<string, unknown>> {
  return (strategy ?? [])
    .filter((provider) => Boolean(provider.capacityProvider))
    .map((provider) => ({
      capacityProvider: provider.capacityProvider,
      base: provider.base ?? 0,
      weight: provider.weight ?? 0,
    }));
}

function summarizeContainerDefinition(
  container: ContainerDefinition,
  accountContext: AccountContext,
): {
  readonly summary: Record<string, unknown>;
  readonly secrets: readonly SecretReferenceSummary[];
  readonly ecrImages: readonly EcrImageReference[];
  readonly cloudWatchLogGroups: readonly { readonly logGroupName: string; readonly region: string }[];
  readonly s3BucketArns: readonly string[];
} {
  const containerName = nullableString(container.name);
  const secrets = (container.secrets ?? [])
    .map((secret): SecretReferenceSummary | null => {
      const name = nullableString(secret.name);
      const valueFrom = nullableString(secret.valueFrom);
      if (!name || !valueFrom) return null;
      return {
        containerName,
        name,
        valueFrom,
        targetArn: normalizeSecretTargetArn(valueFrom),
        provider: classifySecretProvider(valueFrom),
      };
    })
    .filter((secret): secret is SecretReferenceSummary => secret !== null);
  const image = nullableString(container.image);
  const ecrImage = image ? parseEcrImage(image, accountContext) : null;
  const logOptions = container.logConfiguration?.options ?? {};
  const logGroupName = nullableString(logOptions['awslogs-group']);
  const logRegion = nullableString(logOptions['awslogs-region']);
  const environmentFiles = (container.environmentFiles ?? [])
    .map((file) => normalizeS3BucketArn(file.value ?? ''))
    .filter((bucketArn): bucketArn is string => bucketArn !== null);

  return {
    summary: {
      name: containerName,
      image: image ?? '',
      essential: container.essential ?? true,
      cpu: container.cpu ?? 0,
      memory: container.memory ?? null,
      memoryReservation: container.memoryReservation ?? null,
      portMappings: (container.portMappings ?? []).map((portMapping) => ({
        containerPort: portMapping.containerPort ?? 0,
        protocol: portMapping.protocol ?? 'tcp',
      })),
      environment: (container.environment ?? [])
        .filter((variable) => Boolean(variable.name))
        .map((variable) => ({
          name: variable.name ?? '',
          value: variable.value ?? '',
        })),
      secrets: secrets.map((secret) => ({
        name: secret.name,
        valueFrom: secret.valueFrom,
      })),
      logConfiguration: container.logConfiguration
        ? {
            logDriver: container.logConfiguration.logDriver ?? '',
            options: container.logConfiguration.options ?? {},
          }
        : null,
    },
    secrets,
    ecrImages: ecrImage ? [ecrImage] : [],
    cloudWatchLogGroups:
      logGroupName
        ? [{ logGroupName, region: logRegion ?? '' }]
        : [],
    s3BucketArns: environmentFiles,
  };
}

function summarizeVolume(volume: Volume): Record<string, unknown> {
  const efsConfig = volume.efsVolumeConfiguration;
  return {
    name: volume.name ?? '',
    efsVolumeConfiguration: efsConfig
      ? {
          fileSystemId: efsConfig.fileSystemId ?? '',
          rootDirectory: efsConfig.rootDirectory ?? '',
          transitEncryption: efsConfig.transitEncryption ?? '',
        }
      : null,
  };
}

function summarizeTaskDefinitionDependencies(
  taskDefinitionArn: string,
  taskDefinition: TaskDefinition,
  accountContext: AccountContext,
  region: string,
): {
  readonly containerDefinitions: readonly Record<string, unknown>[];
  readonly secretReferences: readonly SecretReferenceSummary[];
  readonly ecrImageReferences: readonly EcrImageReference[];
  readonly cloudWatchLogGroupArns: readonly string[];
  readonly efsFileSystemArns: readonly string[];
  readonly s3BucketArns: readonly string[];
  readonly dependencyEdges: readonly EcsDependencyEdgeSummary[];
} {
  const containerSummaries = (taskDefinition.containerDefinitions ?? []).map((container) =>
    summarizeContainerDefinition(container, accountContext),
  );
  const secretReferences = containerSummaries.flatMap((summary) => summary.secrets);
  const ecrImageReferences = containerSummaries.flatMap((summary) => summary.ecrImages);
  const cloudWatchLogGroupArns = uniqueStrings(
    containerSummaries
      .flatMap((summary) => summary.cloudWatchLogGroups)
      .map((logGroup) =>
        buildCloudWatchLogGroupArn(logGroup.logGroupName, logGroup.region || region, accountContext),
      ),
  );
  const efsFileSystemArns = uniqueStrings(
    (taskDefinition.volumes ?? [])
      .map((volume) => nullableString(volume.efsVolumeConfiguration?.fileSystemId))
      .filter((fileSystemId): fileSystemId is string => fileSystemId !== null)
      .map((fileSystemId) => buildEfsArn(fileSystemId, region, accountContext)),
  );
  const s3BucketArns = uniqueStrings(containerSummaries.flatMap((summary) => summary.s3BucketArns));
  const dependencyEdges: EcsDependencyEdgeSummary[] = [];

  for (const roleArn of compactStrings([taskDefinition.taskRoleArn, taskDefinition.executionRoleArn])) {
    dependencyEdges.push({
      target: roleArn,
      type: EdgeType.IAM_ACCESS,
      relationship: roleArn === taskDefinition.taskRoleArn ? 'uses_task_role' : 'uses_execution_role',
    });
  }
  for (const secret of secretReferences) {
    if (!secret.targetArn || secret.provider === 'other') continue;
    dependencyEdges.push({
      target: secret.targetArn,
      type: EdgeType.DEPENDS_ON,
      relationship: secret.provider === 'ssm' ? 'uses_ssm_parameter' : 'uses_secret',
      metadata: {
        containerName: secret.containerName,
        secretName: secret.name,
        valueFrom: secret.valueFrom,
      },
    });
  }
  for (const image of ecrImageReferences) {
    dependencyEdges.push({
      target: image.repositoryArn,
      type: EdgeType.USES,
      relationship: 'pulls_image_from',
      metadata: {
        image: image.image,
        repositoryUri: image.repositoryUri,
      },
    });
  }
  for (const logGroupArn of cloudWatchLogGroupArns) {
    dependencyEdges.push({
      target: logGroupArn,
      type: EdgeType.USES,
      relationship: 'writes_logs_to',
    });
  }
  for (const fileSystemArn of efsFileSystemArns) {
    dependencyEdges.push({
      target: fileSystemArn,
      type: EdgeType.DEPENDS_ON,
      relationship: 'mounts_efs',
    });
  }
  for (const bucketArn of s3BucketArns) {
    dependencyEdges.push({
      target: bucketArn,
      type: EdgeType.DEPENDS_ON,
      relationship: 'loads_environment_file_from_s3',
    });
  }

  return {
    containerDefinitions: containerSummaries.map((summary) => summary.summary),
    secretReferences,
    ecrImageReferences,
    cloudWatchLogGroupArns,
    efsFileSystemArns,
    s3BucketArns,
    dependencyEdges: dedupeDependencyEdges(taskDefinitionArn, dependencyEdges),
  };
}

function dedupeDependencyEdges(
  source: string,
  edges: readonly EcsDependencyEdgeSummary[],
): readonly EcsDependencyEdgeSummary[] {
  const byKey = new Map<string, EcsDependencyEdgeSummary>();
  for (const edge of edges) {
    byKey.set(`${source}|${edge.target}|${edge.type}|${edge.relationship}`, edge);
  }
  return Array.from(byKey.values());
}

function summarizeServiceNetworkConfiguration(service: Service): Record<string, unknown> | null {
  const awsvpc = service.networkConfiguration?.awsvpcConfiguration;
  if (!awsvpc) return null;
  return {
    awsvpcConfiguration: {
      subnets: compactStrings(awsvpc.subnets ?? []),
      securityGroups: compactStrings(awsvpc.securityGroups ?? []),
      assignPublicIp: awsvpc.assignPublicIp ?? '',
    },
  };
}

function summarizeServiceLoadBalancers(service: Service): Array<Record<string, unknown>> {
  return (service.loadBalancers ?? [])
    .filter((loadBalancer) => Boolean(loadBalancer.targetGroupArn))
    .map((loadBalancer) => ({
      targetGroupArn: loadBalancer.targetGroupArn ?? '',
      containerName: loadBalancer.containerName ?? '',
      containerPort: loadBalancer.containerPort ?? 0,
    }));
}

function summarizeServiceRegistries(service: Service): Array<Record<string, unknown>> {
  return (service.serviceRegistries ?? [])
    .filter((registry) => Boolean(registry.registryArn))
    .map((registry) => ({
      registryArn: registry.registryArn ?? '',
    }));
}

function summarizeDeploymentConfiguration(service: Service): Record<string, unknown> | null {
  const deploymentConfiguration = service.deploymentConfiguration;
  if (!deploymentConfiguration) return null;
  return {
    deploymentCircuitBreaker: deploymentConfiguration.deploymentCircuitBreaker
      ? {
          enable: deploymentConfiguration.deploymentCircuitBreaker.enable ?? false,
          rollback: deploymentConfiguration.deploymentCircuitBreaker.rollback ?? false,
        }
      : null,
    minimumHealthyPercent: deploymentConfiguration.minimumHealthyPercent ?? 100,
    maximumPercent: deploymentConfiguration.maximumPercent ?? 200,
  };
}

function summarizeDeployments(service: Service): Array<Record<string, unknown>> {
  return (service.deployments ?? []).map((deployment) => ({
    status: deployment.status ?? '',
    desiredCount: deployment.desiredCount ?? 0,
    runningCount: deployment.runningCount ?? 0,
    taskDefinition: deployment.taskDefinition ?? '',
  }));
}

function buildClusterDependencyEdges(
  cluster: Cluster,
  clusterArn: string,
  capacityProviderNameToArn: ReadonlyMap<string, string>,
  accountContext: AccountContext,
  region: string,
): readonly EcsDependencyEdgeSummary[] {
  const edges: EcsDependencyEdgeSummary[] = [];
  for (const capacityProviderName of compactStrings(cluster.capacityProviders ?? [])) {
    edges.push({
      target:
        capacityProviderNameToArn.get(capacityProviderName) ??
        buildCapacityProviderArn(capacityProviderName, region, accountContext),
      type: EdgeType.USES,
      relationship: 'uses_capacity_provider',
      metadata: { capacityProviderName },
    });
  }

  for (const kmsKeyArn of compactStrings([
    normalizeKmsKeyArn(
      cluster.configuration?.managedStorageConfiguration?.kmsKeyId,
      region,
      accountContext,
    ),
    normalizeKmsKeyArn(
      cluster.configuration?.managedStorageConfiguration?.fargateEphemeralStorageKmsKeyId,
      region,
      accountContext,
    ),
    normalizeKmsKeyArn(
      cluster.configuration?.executeCommandConfiguration?.kmsKeyId,
      region,
      accountContext,
    ),
  ])) {
    edges.push({
      target: kmsKeyArn,
      type: EdgeType.DEPENDS_ON,
      relationship: 'encrypted_by',
    });
  }

  return dedupeDependencyEdges(clusterArn, edges);
}

function buildServiceDependencyEdges(input: {
  readonly service: Service;
  readonly clusterArn: string;
  readonly taskDefinitionArn: string | null;
  readonly accountContext: AccountContext;
  readonly region: string;
}): readonly EcsDependencyEdgeSummary[] {
  const edges: EcsDependencyEdgeSummary[] = [
    {
      target: input.clusterArn,
      type: EdgeType.DEPENDS_ON,
      relationship: 'runs_in_cluster',
    },
  ];

  if (input.taskDefinitionArn) {
    edges.push({
      target: input.taskDefinitionArn,
      type: EdgeType.USES,
      relationship: 'uses_task_definition',
    });
  }
  for (const loadBalancer of input.service.loadBalancers ?? []) {
    if (!loadBalancer.targetGroupArn) continue;
    edges.push({
      target: loadBalancer.targetGroupArn,
      type: EdgeType.ROUTES_TO,
      relationship: 'routed_to_target_group',
      metadata: {
        containerName: loadBalancer.containerName,
        containerPort: loadBalancer.containerPort,
      },
    });
  }
  for (const registry of input.service.serviceRegistries ?? []) {
    if (!registry.registryArn) continue;
    edges.push({
      target: registry.registryArn,
      type: EdgeType.DEPENDS_ON,
      relationship: 'uses_service_discovery_registry',
    });
  }
  for (const roleArn of compactStrings([input.service.roleArn])) {
    edges.push({
      target: roleArn,
      type: EdgeType.IAM_ACCESS,
      relationship: 'uses_service_role',
    });
  }
  return dedupeDependencyEdges(input.service.serviceArn ?? input.service.serviceName ?? 'service', edges);
}

function buildTaskDependencyEdges(input: {
  readonly task: Task;
  readonly serviceArn: string;
  readonly capacityProviderNameToArn: ReadonlyMap<string, string>;
  readonly accountContext: AccountContext;
  readonly region: string;
}): readonly EcsDependencyEdgeSummary[] {
  const edges: EcsDependencyEdgeSummary[] = [
    {
      target: input.serviceArn,
      type: EdgeType.DEPENDS_ON,
      relationship: 'instance_of_service',
    },
  ];
  if (input.task.taskDefinitionArn) {
    edges.push({
      target: input.task.taskDefinitionArn,
      type: EdgeType.USES,
      relationship: 'uses_task_definition',
    });
  }
  if (input.task.capacityProviderName) {
    edges.push({
      target:
        input.capacityProviderNameToArn.get(input.task.capacityProviderName) ??
        buildCapacityProviderArn(input.task.capacityProviderName, input.region, input.accountContext),
      type: EdgeType.USES,
      relationship: 'placed_on_capacity_provider',
      metadata: { capacityProviderName: input.task.capacityProviderName },
    });
  }
  return dedupeDependencyEdges(input.task.taskArn ?? 'task', edges);
}

function inferServiceNameFromTask(task: Task): string | null {
  const group = nullableString(task.group);
  if (!group?.startsWith('service:')) return null;
  return group.slice('service:'.length).trim() || null;
}

function buildTaskResource(input: {
  readonly task: Task;
  readonly clusterName: string;
  readonly clusterArn: string;
  readonly serviceArn: string;
  readonly serviceName: string;
  readonly region: string;
  readonly accountContext: AccountContext;
  readonly capacityProviderNameToArn: ReadonlyMap<string, string>;
}): DiscoveredResource {
  const taskId = extractTaskId(input.task.taskArn);
  const taskArn =
    input.task.taskArn ??
    buildTaskArn(input.clusterName, taskId, input.region, input.accountContext);
  const tags = tagsArrayToMap(input.task.tags);

  return createResource({
    source: 'aws',
    arn: taskArn,
    name: taskId,
    kind: 'infra',
    type: 'ECS_TASK',
    ...(input.task.taskArn ? {} : { account: input.accountContext }),
    tags,
    metadata: {
      region: input.region,
      taskArn,
      clusterArn: input.task.clusterArn ?? input.clusterArn,
      clusterName: input.clusterName,
      serviceArn: input.serviceArn,
      serviceName: inferServiceNameFromTask(input.task) ?? input.serviceName,
      taskDefinitionArn: input.task.taskDefinitionArn ?? '',
      lastStatus: input.task.lastStatus ?? '',
      desiredStatus: input.task.desiredStatus ?? '',
      launchType: input.task.launchType ?? null,
      capacityProviderName: input.task.capacityProviderName ?? null,
      availabilityZone: input.task.availabilityZone ?? null,
      connectivity: input.task.connectivity ?? '',
      healthStatus: input.task.healthStatus ?? '',
      startedAt: input.task.startedAt ?? null,
      cpu: input.task.cpu ?? null,
      memory: input.task.memory ?? null,
      group: input.task.group ?? null,
      subnetIds: compactStrings(
        (input.task.attachments ?? []).flatMap((attachment) =>
          (attachment.details ?? [])
            .filter((detail) => detail.name === 'subnetId')
            .map((detail) => detail.value),
        ),
      ),
      securityGroups: compactStrings(
        (input.task.attachments ?? []).flatMap((attachment) =>
          (attachment.details ?? [])
            .filter((detail) => detail.name === 'securityGroups')
            .flatMap((detail) => detail.value?.split(',') ?? []),
        ),
      ),
      directDependencyEdges: buildTaskDependencyEdges({
        task: input.task,
        serviceArn: input.serviceArn,
        capacityProviderNameToArn: input.capacityProviderNameToArn,
        accountContext: input.accountContext,
        region: input.region,
      }),
      displayName: taskId,
      ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
    },
  });
}

function buildTaskDefinitionResource(input: {
  readonly taskDefinition: TaskDefinition;
  readonly tags: Record<string, string>;
  readonly region: string;
  readonly accountContext: AccountContext;
}): DiscoveredResource | null {
  const family = nullableString(input.taskDefinition.family) ?? 'task-definition';
  const revision = input.taskDefinition.revision ?? 1;
  const taskDefinitionArn =
    input.taskDefinition.taskDefinitionArn ??
    buildTaskDefinitionArn(family, revision, input.region, input.accountContext);
  const displayName = getNameTag(input.tags) ?? `${family}:${revision}`;
  const dependencies = summarizeTaskDefinitionDependencies(
    taskDefinitionArn,
    input.taskDefinition,
    input.accountContext,
    input.region,
  );

  return createResource({
    source: 'aws',
    arn: taskDefinitionArn,
    name: displayName,
    kind: 'infra',
    type: 'ECS_TASK_DEFINITION',
    ...(input.taskDefinition.taskDefinitionArn ? {} : { account: input.accountContext }),
    tags: input.tags,
    metadata: {
      region: input.region,
      family,
      revision,
      taskDefinitionArn,
      status: input.taskDefinition.status ?? '',
      taskRoleArn: input.taskDefinition.taskRoleArn ?? null,
      executionRoleArn: input.taskDefinition.executionRoleArn ?? null,
      networkMode: input.taskDefinition.networkMode ?? '',
      requiresCompatibilities: compactStrings(input.taskDefinition.requiresCompatibilities ?? []),
      cpu: input.taskDefinition.cpu ?? null,
      memory: input.taskDefinition.memory ?? null,
      containerDefinitions: dependencies.containerDefinitions,
      volumes: (input.taskDefinition.volumes ?? []).map((volume) => summarizeVolume(volume)),
      ephemeralStorage: input.taskDefinition.ephemeralStorage
        ? { sizeInGiB: input.taskDefinition.ephemeralStorage.sizeInGiB ?? 0 }
        : null,
      secretReferences: dependencies.secretReferences,
      ecrImageReferences: dependencies.ecrImageReferences,
      cloudWatchLogGroupArns: dependencies.cloudWatchLogGroupArns,
      efsFileSystemArns: dependencies.efsFileSystemArns,
      s3BucketArns: dependencies.s3BucketArns,
      directDependencyEdges: dependencies.dependencyEdges,
      displayName,
      ...(Object.keys(input.tags).length > 0 ? { awsTags: input.tags } : {}),
    },
  });
}

function buildServiceResource(input: {
  readonly service: Service;
  readonly clusterArn: string;
  readonly clusterName: string;
  readonly serviceArn: string;
  readonly serviceName: string;
  readonly taskDefinitionArn: string | null;
  readonly taskDefinition: TaskDefinition | null;
  readonly tags: Record<string, string>;
  readonly region: string;
  readonly accountContext: AccountContext;
  readonly clusterDefaultCapacityProviderStrategy: readonly Record<string, unknown>[];
}): DiscoveredResource {
  const runtimeSubnets =
    input.service.networkConfiguration?.awsvpcConfiguration?.subnets ?? [];
  const runtimeSecurityGroups =
    input.service.networkConfiguration?.awsvpcConfiguration?.securityGroups ?? [];
  const capacityProviderStrategy = summarizeCapacityProviderStrategy(
    input.service.capacityProviderStrategy,
  );
  const displayName = getNameTag(input.tags) ?? input.serviceName;

  return createResource({
    source: 'aws',
    arn: input.serviceArn,
    name: displayName,
    kind: 'service',
    type: 'ECS_SERVICE',
    ...(input.service.serviceArn ? {} : { account: input.accountContext }),
    tags: input.tags,
    metadata: {
      region: input.region,
      serviceName: input.serviceName,
      serviceArn: input.serviceArn,
      clusterArn: input.clusterArn,
      clusterName: input.clusterName,
      taskDefinitionArn: input.taskDefinitionArn ?? '',
      desiredCount: input.service.desiredCount ?? 0,
      runningCount: input.service.runningCount ?? 0,
      pendingCount: input.service.pendingCount ?? 0,
      launchType: input.service.launchType ?? null,
      capacityProviderStrategy: capacityProviderStrategy.length > 0 ? capacityProviderStrategy : null,
      effectiveCapacityProviderStrategy:
        capacityProviderStrategy.length > 0
          ? capacityProviderStrategy
          : input.clusterDefaultCapacityProviderStrategy,
      platformVersion: input.service.platformVersion ?? null,
      networkConfiguration: summarizeServiceNetworkConfiguration(input.service),
      subnetId: runtimeSubnets[0] ?? undefined,
      subnetIds: compactStrings(runtimeSubnets),
      securityGroups: compactStrings(runtimeSecurityGroups),
      assignPublicIp: input.service.networkConfiguration?.awsvpcConfiguration?.assignPublicIp,
      loadBalancers: summarizeServiceLoadBalancers(input.service),
      serviceRegistries: summarizeServiceRegistries(input.service),
      deploymentConfiguration: summarizeDeploymentConfiguration(input.service),
      deployments: summarizeDeployments(input.service),
      schedulingStrategy: input.service.schedulingStrategy ?? '',
      taskDefinitionFamily: input.taskDefinition?.family,
      taskDefinitionRevision: input.taskDefinition?.revision,
      taskRoleArn: input.taskDefinition?.taskRoleArn ?? null,
      executionRoleArn: input.taskDefinition?.executionRoleArn ?? null,
      roleArn: input.service.roleArn ?? null,
      launchTypeEffective:
        input.service.launchType ??
        (input.taskDefinition?.requiresCompatibilities?.includes('FARGATE') ? 'FARGATE' : null),
      fargate:
        input.service.launchType === 'FARGATE' ||
        input.taskDefinition?.requiresCompatibilities?.includes('FARGATE') === true ||
        capacityProviderStrategy.some((provider) => provider.capacityProvider === 'FARGATE'),
      directDependencyEdges: buildServiceDependencyEdges({
        service: input.service,
        clusterArn: input.clusterArn,
        taskDefinitionArn: input.taskDefinitionArn,
        accountContext: input.accountContext,
        region: input.region,
      }),
      displayName,
      ...(Object.keys(input.tags).length > 0 ? { awsTags: input.tags } : {}),
    },
  });
}

function buildClusterResource(input: {
  readonly cluster: Cluster;
  readonly clusterArn: string;
  readonly clusterName: string;
  readonly tags: Record<string, string>;
  readonly region: string;
  readonly accountContext: AccountContext;
  readonly capacityProviderNameToArn: ReadonlyMap<string, string>;
}): DiscoveredResource {
  const displayName = getNameTag(input.tags) ?? input.clusterName;
  const containerInsights =
    input.cluster.settings?.some(
      (setting) => setting.name === 'containerInsights' && setting.value === 'enabled',
    ) ?? false;
  const defaultCapacityProviderStrategy = summarizeCapacityProviderStrategy(
    input.cluster.defaultCapacityProviderStrategy,
  );

  return createResource({
    source: 'aws',
    arn: input.clusterArn,
    name: displayName,
    kind: 'infra',
    type: 'ECS_CLUSTER',
    ...(input.cluster.clusterArn ? {} : { account: input.accountContext }),
    tags: input.tags,
    metadata: {
      region: input.region,
      clusterName: input.clusterName,
      clusterArn: input.clusterArn,
      status: input.cluster.status ?? '',
      registeredContainerInstancesCount: input.cluster.registeredContainerInstancesCount ?? 0,
      activeServicesCount: input.cluster.activeServicesCount ?? 0,
      runningTasksCount: input.cluster.runningTasksCount ?? 0,
      capacityProviders: compactStrings(input.cluster.capacityProviders ?? []),
      defaultCapacityProviderStrategy,
      settings: { containerInsights },
      rawSettings: (input.cluster.settings ?? []).map((setting) => ({
        name: setting.name,
        value: setting.value,
      })),
      managedStorageConfiguration: input.cluster.configuration?.managedStorageConfiguration
        ? {
            kmsKeyId: input.cluster.configuration.managedStorageConfiguration.kmsKeyId ?? null,
            fargateEphemeralStorageKmsKeyId:
              input.cluster.configuration.managedStorageConfiguration.fargateEphemeralStorageKmsKeyId ??
              null,
          }
        : null,
      executeCommandConfiguration: input.cluster.configuration?.executeCommandConfiguration
        ? {
            kmsKeyId: input.cluster.configuration.executeCommandConfiguration.kmsKeyId ?? null,
            logging: input.cluster.configuration.executeCommandConfiguration.logging ?? null,
            logConfiguration: input.cluster.configuration.executeCommandConfiguration.logConfiguration
              ? {
                  cloudWatchLogGroupName:
                    input.cluster.configuration.executeCommandConfiguration.logConfiguration
                      .cloudWatchLogGroupName ?? null,
                  s3BucketName:
                    input.cluster.configuration.executeCommandConfiguration.logConfiguration
                      .s3BucketName ?? null,
                }
              : null,
          }
        : null,
      directDependencyEdges: buildClusterDependencyEdges(
        input.cluster,
        input.clusterArn,
        input.capacityProviderNameToArn,
        input.accountContext,
        input.region,
      ),
      displayName,
      ...(Object.keys(input.tags).length > 0 ? { awsTags: input.tags } : {}),
    },
  });
}

function buildCapacityProviderResource(input: {
  readonly capacityProvider: CapacityProvider;
  readonly region: string;
  readonly accountContext: AccountContext;
}): DiscoveredResource | null {
  const name = nullableString(input.capacityProvider.name);
  if (!name) return null;
  const capacityProviderArn =
    input.capacityProvider.capacityProviderArn ??
    buildCapacityProviderArn(name, input.region, input.accountContext);
  const tags = tagsArrayToMap(input.capacityProvider.tags);
  const displayName = getNameTag(tags) ?? name;
  const autoScalingGroupProvider = input.capacityProvider.autoScalingGroupProvider;

  return createResource({
    source: 'aws',
    arn: capacityProviderArn,
    name: displayName,
    kind: 'infra',
    type: 'ECS_CAPACITY_PROVIDER',
    ...(input.capacityProvider.capacityProviderArn ? {} : { account: input.accountContext }),
    tags,
    metadata: {
      region: input.region,
      capacityProviderArn,
      name,
      status: input.capacityProvider.status ?? '',
      autoScalingGroupProvider: autoScalingGroupProvider
        ? {
            autoScalingGroupArn: autoScalingGroupProvider.autoScalingGroupArn ?? '',
            managedScaling: autoScalingGroupProvider.managedScaling
              ? {
                  status: autoScalingGroupProvider.managedScaling.status ?? '',
                  targetCapacity: autoScalingGroupProvider.managedScaling.targetCapacity ?? 0,
                  minimumScalingStepSize:
                    autoScalingGroupProvider.managedScaling.minimumScalingStepSize ?? 0,
                  maximumScalingStepSize:
                    autoScalingGroupProvider.managedScaling.maximumScalingStepSize ?? 0,
                }
              : null,
            managedTerminationProtection:
              autoScalingGroupProvider.managedTerminationProtection ?? '',
          }
        : null,
      directDependencyEdges: autoScalingGroupProvider?.autoScalingGroupArn
        ? [
            {
              target: autoScalingGroupProvider.autoScalingGroupArn,
              type: EdgeType.USES,
              relationship: 'managed_by_auto_scaling_group',
            },
          ]
        : [],
      displayName,
      ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
    },
  });
}

export async function scanEcsServices(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const ecs = createAwsClient(ECSClient, options);
  const resolveAccountContext = createAccountContextResolver(options);
  let fallbackAccountContext: AccountContext | null = null;
  const resolveAccountContextFor = async (arn?: string | null): Promise<AccountContext> => {
    const fromArn = accountContextFromArn(arn);
    if (fromArn) {
      fallbackAccountContext = fallbackAccountContext ?? fromArn;
      return fromArn;
    }
    if (!fallbackAccountContext) {
      fallbackAccountContext = await resolveAccountContext();
    }
    return fallbackAccountContext;
  };
  const warnings: string[] = [];
  const resources: DiscoveredResource[] = [];
  const taskDefinitionCache = new Map<string, TaskDefinitionCacheEntry>();
  const taskDefinitionResources = new Map<string, DiscoveredResource>();
  const taskResources = new Map<string, DiscoveredResource>();
  const capacityProviderNames = new Set<string>();

  const clusterArns = await paginateAws(
    (nextToken) =>
      sendWithRetry(() =>
        ecs.send(new ListClustersCommand({ nextToken }), getAwsCommandOptions(options)),
      ),
    (response) => response.clusterArns,
    (response) => response.nextToken,
  );
  const clusters = await describeClusters(ecs, options, clusterArns);

  const capacityProviderNameToArn = new Map<string, string>();
  for (const cluster of clusters) {
    const clusterAccountContext = accountContextFromArn(cluster.clusterArn);
    for (const capacityProviderName of compactStrings(cluster.capacityProviders ?? [])) {
      capacityProviderNames.add(capacityProviderName);
      if (clusterAccountContext) {
        capacityProviderNameToArn.set(
          capacityProviderName,
          buildCapacityProviderArn(capacityProviderName, options.region, clusterAccountContext),
        );
      }
    }
    for (const strategy of cluster.defaultCapacityProviderStrategy ?? []) {
      if (strategy.capacityProvider) capacityProviderNames.add(strategy.capacityProvider);
    }
  }

  for (const cluster of clusters) {
    const clusterName = cluster.clusterName ?? extractLastArnSegment(cluster.clusterArn) ?? 'ecs-cluster';
    const accountContext = await resolveAccountContextFor(cluster.clusterArn);
    const clusterArn =
      cluster.clusterArn ?? buildClusterArn(clusterName, options.region, accountContext);
    const clusterTags = tagsArrayToMap(cluster.tags);
    const defaultCapacityProviderStrategy = summarizeCapacityProviderStrategy(
      cluster.defaultCapacityProviderStrategy,
    );

    resources.push(
      buildClusterResource({
        cluster,
        clusterArn,
        clusterName,
        tags: clusterTags,
        region: options.region,
        accountContext,
        capacityProviderNameToArn,
      }),
    );

    let serviceArns: string[] = [];
    try {
      serviceArns = await paginateAws(
        (nextToken) =>
          sendWithRetry(() =>
            ecs.send(
              new ListServicesCommand({ cluster: clusterArn, nextToken }),
              getAwsCommandOptions(options),
            ),
          ),
        (response) => response.serviceArns,
        (response) => response.nextToken,
      );
    } catch (error) {
      warnings.push(
        `ECS services unavailable for cluster ${clusterName} in ${options.region} (${getAwsFailureType(error)}).`,
      );
      continue;
    }

    let services: readonly Service[] = [];
    try {
      services = await describeServices(ecs, options, clusterArn, serviceArns);
    } catch (error) {
      warnings.push(
        `ECS service details unavailable for cluster ${clusterName} in ${options.region} (${getAwsFailureType(error)}).`,
      );
      continue;
    }

    for (const service of services) {
      const serviceName =
        service.serviceName ?? extractLastArnSegment(service.serviceArn) ?? 'ecs-service';
      const serviceArn =
        service.serviceArn ?? buildServiceArn(clusterName, serviceName, options.region, accountContext);
      for (const strategy of service.capacityProviderStrategy ?? []) {
        if (strategy.capacityProvider) capacityProviderNames.add(strategy.capacityProvider);
      }
      for (const capacityProviderName of compactStrings(
        service.capacityProviderStrategy?.map((strategy) => strategy.capacityProvider) ?? [],
      )) {
        if (!capacityProviderNameToArn.has(capacityProviderName)) {
          capacityProviderNameToArn.set(
            capacityProviderName,
            buildCapacityProviderArn(capacityProviderName, options.region, accountContext),
          );
        }
      }

      const serviceTags = tagsArrayToMap(service.tags);
      const taskDefinitionArn = nullableString(service.taskDefinition);
      const taskDefinitionEntry = taskDefinitionArn
        ? await describeTaskDefinitionCached(
            ecs,
            options,
            taskDefinitionArn,
            taskDefinitionCache,
            warnings,
          )
        : { taskDefinition: null, tags: {} };

      if (taskDefinitionEntry.taskDefinition) {
        const taskDefinitionResource = buildTaskDefinitionResource({
          taskDefinition: taskDefinitionEntry.taskDefinition,
          tags: taskDefinitionEntry.tags,
          region: options.region,
          accountContext,
        });
        if (taskDefinitionResource) {
          taskDefinitionResources.set(taskDefinitionResource.arn, taskDefinitionResource);
        }
      }

      resources.push(
        buildServiceResource({
          service,
          clusterArn,
          clusterName,
          serviceArn,
          serviceName,
          taskDefinitionArn:
            taskDefinitionEntry.taskDefinition?.taskDefinitionArn ?? taskDefinitionArn,
          taskDefinition: taskDefinitionEntry.taskDefinition,
          tags: serviceTags,
          region: options.region,
          accountContext,
          clusterDefaultCapacityProviderStrategy: defaultCapacityProviderStrategy,
        }),
      );

      let tasks: readonly Task[] = [];
      try {
        tasks = await describeRunningServiceTasks(ecs, options, clusterArn, serviceName);
      } catch (error) {
        warnings.push(
          `ECS running tasks unavailable for service ${serviceName} in ${options.region} (${getAwsFailureType(error)}).`,
        );
      }

      for (const task of tasks) {
        if (task.capacityProviderName) capacityProviderNames.add(task.capacityProviderName);
        if (task.capacityProviderName && !capacityProviderNameToArn.has(task.capacityProviderName)) {
          capacityProviderNameToArn.set(
            task.capacityProviderName,
            buildCapacityProviderArn(task.capacityProviderName, options.region, accountContext),
          );
        }
        const taskResource = buildTaskResource({
          task,
          clusterName,
          clusterArn,
          serviceArn,
          serviceName,
          region: options.region,
          accountContext,
          capacityProviderNameToArn,
        });
        taskResources.set(taskResource.arn, taskResource);
      }
    }
  }

  const capacityProviders = await describeCapacityProviders(
    ecs,
    options,
    Array.from(capacityProviderNames),
    warnings,
  );
  for (const capacityProvider of capacityProviders) {
    if (capacityProvider.name && capacityProvider.capacityProviderArn) {
      capacityProviderNameToArn.set(capacityProvider.name, capacityProvider.capacityProviderArn);
    }
  }
  const capacityProviderResources = capacityProviders
    .map((capacityProvider) => {
      const providerAccountContext =
        accountContextFromArn(capacityProvider.capacityProviderArn) ?? fallbackAccountContext;
      if (!providerAccountContext) return null;
      return buildCapacityProviderResource({
        capacityProvider,
        region: options.region,
        accountContext: providerAccountContext,
      });
    })
    .filter((resource): resource is DiscoveredResource => resource !== null);

  resources.push(...taskDefinitionResources.values());
  resources.push(...taskResources.values());
  resources.push(...capacityProviderResources);

  return { resources, warnings };
}
