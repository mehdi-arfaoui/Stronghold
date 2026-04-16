/**
 * Scans Amazon Aurora clusters, cluster members, and global databases.
 */

import {
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  DescribeGlobalClustersCommand,
  ListTagsForResourceCommand,
  RDSClient,
  type DBCluster,
  type DBClusterMember,
  type DBInstance,
  type GlobalCluster,
} from '@aws-sdk/client-rds';
import type { DiscoveredResource } from '../../../types/discovery.js';
import type { AccountContext } from '../../../identity/index.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import {
  createAccountContextResolver,
  createResource,
  paginateAws,
} from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, tagsArrayToMap } from '../tag-utils.js';

interface AuroraScannerConfig {
  readonly includeGlobalClusters?: boolean;
}

function isAuroraEngine(engine: string | undefined): boolean {
  return typeof engine === 'string' && engine.startsWith('aurora');
}

function toIsoString(value: Date | undefined): string | undefined {
  return value?.toISOString();
}

function readSubnetIds(instance: DBInstance): readonly string[] {
  return (instance.DBSubnetGroup?.Subnets ?? [])
    .map((subnet) => subnet.SubnetIdentifier)
    .filter((subnetId): subnetId is string => Boolean(subnetId));
}

function resolveSubnetId(instance: DBInstance): string | undefined {
  const availabilityZone = instance.AvailabilityZone;
  if (!availabilityZone) return readSubnetIds(instance)[0];

  return (
    instance.DBSubnetGroup?.Subnets?.find(
      (subnet) => subnet.SubnetAvailabilityZone?.Name === availabilityZone,
    )?.SubnetIdentifier ?? readSubnetIds(instance)[0]
  );
}

function buildAuroraCluster(
  cluster: DBCluster,
  region: string,
  accountContext: AccountContext,
  tags: Record<string, string>,
): DiscoveredResource {
  const clusterId = cluster.DBClusterIdentifier ?? 'aurora-cluster';
  const displayName = getNameTag(tags) ?? clusterId;
  const clusterArn =
    cluster.DBClusterArn ??
    `arn:${accountContext.partition}:rds:${region}:${accountContext.accountId}:cluster:${clusterId}`;
  return createResource({
    source: 'aws',
    arn: clusterArn,
    name: displayName,
    kind: 'infra',
    type: 'AURORA_CLUSTER',
    ip: cluster.Endpoint ?? null,
    account: accountContext,
    tags,
    metadata: {
      region,
      dbClusterIdentifier: clusterId,
      dbClusterArn: clusterArn,
      engine: cluster.Engine,
      engineVersion: cluster.EngineVersion,
      clusterEndpoint: cluster.Endpoint,
      readerEndpoint: cluster.ReaderEndpoint,
      multiAZ: Boolean(cluster.MultiAZ),
      availabilityZones: (cluster.AvailabilityZones ?? []).filter(
        (zone): zone is string => Boolean(zone),
      ),
      backupRetentionPeriod: cluster.BackupRetentionPeriod ?? null,
      backtrackWindow: cluster.BacktrackWindow ?? 0,
      deletionProtection: Boolean(cluster.DeletionProtection),
      storageEncrypted: Boolean(cluster.StorageEncrypted),
      replicationSourceIdentifier: cluster.ReplicationSourceIdentifier ?? null,
      globalClusterIdentifier: cluster.GlobalClusterIdentifier ?? null,
      serverlessV2ScalingConfiguration: cluster.ServerlessV2ScalingConfiguration
        ? {
            minCapacity: cluster.ServerlessV2ScalingConfiguration.MinCapacity,
            maxCapacity: cluster.ServerlessV2ScalingConfiguration.MaxCapacity,
            secondsUntilAutoPause:
              cluster.ServerlessV2ScalingConfiguration.SecondsUntilAutoPause,
          }
        : null,
      latestRestorableTime: toIsoString(cluster.LatestRestorableTime) ?? null,
      status: cluster.Status,
      securityGroups: (cluster.VpcSecurityGroups ?? [])
        .map((group) => group.VpcSecurityGroupId)
        .filter((groupId): groupId is string => Boolean(groupId)),
      memberInstanceIds: (cluster.DBClusterMembers ?? [])
        .map((member) => member.DBInstanceIdentifier)
        .filter((instanceId): instanceId is string => Boolean(instanceId)),
      replicaCount: (cluster.DBClusterMembers ?? []).filter((member) => !member.IsClusterWriter)
        .length,
      displayName,
      ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
    },
  });
}

function buildAuroraInstance(
  instance: DBInstance,
  member: DBClusterMember | undefined,
  cluster: DBCluster,
  region: string,
  accountContext: AccountContext,
  tags: Record<string, string>,
): DiscoveredResource {
  const instanceId = instance.DBInstanceIdentifier ?? 'aurora-instance';
  const displayName = getNameTag(tags) ?? instanceId;
  const instanceArn =
    instance.DBInstanceArn ??
    `arn:${accountContext.partition}:rds:${region}:${accountContext.accountId}:db:${instanceId}`;
  return createResource({
    source: 'aws',
    arn: instanceArn,
    name: displayName,
    kind: 'infra',
    type: 'AURORA_INSTANCE',
    ip: instance.Endpoint?.Address ?? null,
    account: accountContext,
    tags,
    metadata: {
      region,
      dbInstanceIdentifier: instanceId,
      dbInstanceArn: instanceArn,
      dbClusterIdentifier: cluster.DBClusterIdentifier,
      dbClusterArn: cluster.DBClusterArn,
      engine: instance.Engine ?? cluster.Engine,
      instanceClass:
        instance.DBInstanceClass ??
        (cluster.ServerlessV2ScalingConfiguration ? 'db.serverless' : null),
      availabilityZone: instance.AvailabilityZone,
      isClusterWriter: Boolean(member?.IsClusterWriter),
      promotionTier: member?.PromotionTier ?? null,
      status: instance.DBInstanceStatus,
      performanceInsightsEnabled: Boolean(instance.PerformanceInsightsEnabled),
      subnetId: resolveSubnetId(instance),
      subnetIds: readSubnetIds(instance),
      vpcId: instance.DBSubnetGroup?.VpcId,
      securityGroups: (instance.VpcSecurityGroups ?? [])
        .map((group) => group.VpcSecurityGroupId)
        .filter((groupId): groupId is string => Boolean(groupId)),
      endpointAddress: instance.Endpoint?.Address,
      endpointPort: instance.Endpoint?.Port,
      displayName,
      ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
    },
  });
}

function buildAuroraGlobal(
  globalCluster: GlobalCluster,
  accountContext: AccountContext,
  tags: Record<string, string>,
): DiscoveredResource {
  const globalClusterIdentifier = globalCluster.GlobalClusterIdentifier ?? 'aurora-global';
  const displayName = getNameTag(tags) ?? globalClusterIdentifier;
  const globalClusterArn =
    globalCluster.GlobalClusterArn ??
    `arn:${accountContext.partition}:rds::${accountContext.accountId}:global-cluster:${globalClusterIdentifier}`;
  return createResource({
    source: 'aws',
    arn: globalClusterArn,
    name: displayName,
    kind: 'infra',
    type: 'AURORA_GLOBAL',
    account: accountContext,
    tags,
    metadata: {
      region: 'global',
      globalClusterIdentifier,
      globalClusterArn,
      globalClusterMembers: (globalCluster.GlobalClusterMembers ?? []).map((member) => ({
        DBClusterArn: member.DBClusterArn,
        IsWriter: member.IsWriter,
        GlobalWriteForwardingStatus: member.GlobalWriteForwardingStatus,
      })),
      status: globalCluster.Status,
      engine: globalCluster.Engine,
      engineVersion: globalCluster.EngineVersion,
      storageEncrypted: globalCluster.StorageEncrypted,
      displayName,
      ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
    },
  });
}

async function describeAuroraInstances(
  rds: RDSClient,
  options: AwsClientOptions,
  cluster: DBCluster,
): Promise<readonly DBInstance[]> {
  const filterValue = cluster.DBClusterArn ?? cluster.DBClusterIdentifier;
  if (!filterValue) return [];

  return paginateAws(
    (marker) =>
      rds.send(
        new DescribeDBInstancesCommand({
          Marker: marker,
          Filters: [{ Name: 'db-cluster-id', Values: [filterValue] }],
        }),
        getAwsCommandOptions(options),
      ),
    (response) => response.DBInstances,
    (response) => response.Marker,
  );
}

export async function scanAuroraClusters(
  options: AwsClientOptions,
  config: AuroraScannerConfig = {},
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const rds = createAwsClient(RDSClient, options);
  const warnings: string[] = [];
  const resources: DiscoveredResource[] = [];
  const tagWarnings = new Set<string>();
  const accountContext = await createAccountContextResolver(options)();
  const clusters = (
    await paginateAws(
      (marker) =>
        rds.send(new DescribeDBClustersCommand({ Marker: marker }), getAwsCommandOptions(options)),
      (response) => response.DBClusters,
      (response) => response.Marker,
    )
  ).filter((cluster) => isAuroraEngine(cluster.Engine));

  for (const cluster of clusters) {
    const clusterTags = cluster.DBClusterArn
      ? await fetchAwsTagsWithRetry(
          () =>
            rds.send(
              new ListTagsForResourceCommand({ ResourceName: cluster.DBClusterArn! }),
              getAwsCommandOptions(options),
            ),
          (response) => tagsArrayToMap(response.TagList),
          {
            description: `Aurora tag discovery unavailable in ${options.region}`,
            warnings,
            warningDeduper: tagWarnings,
          },
        )
      : {};
    resources.push(buildAuroraCluster(cluster, options.region, accountContext, clusterTags));

    try {
      const membersById = new Map(
        (cluster.DBClusterMembers ?? [])
          .map((member) => [member.DBInstanceIdentifier, member] as const)
          .filter((entry): entry is readonly [string, DBClusterMember] => Boolean(entry[0])),
      );
      const instances = await describeAuroraInstances(rds, options, cluster);
      for (const instance of instances) {
        const instanceTags = instance.DBInstanceArn
          ? await fetchAwsTagsWithRetry(
              () =>
                rds.send(
                  new ListTagsForResourceCommand({ ResourceName: instance.DBInstanceArn! }),
                  getAwsCommandOptions(options),
                ),
              (response) => tagsArrayToMap(response.TagList),
              {
                description: `Aurora tag discovery unavailable in ${options.region}`,
                warnings,
                warningDeduper: tagWarnings,
              },
            )
          : {};
        resources.push(
          buildAuroraInstance(
            instance,
            membersById.get(instance.DBInstanceIdentifier ?? ''),
            cluster,
            options.region,
            accountContext,
            instanceTags,
          ),
        );
      }
    } catch {
      warnings.push(
        `Aurora instance members unavailable for cluster ${cluster.DBClusterIdentifier ?? 'unknown'}.`,
      );
    }
  }

  if (config.includeGlobalClusters !== false) {
    try {
      const globalClusters = await paginateAws(
        (marker) =>
          rds.send(
            new DescribeGlobalClustersCommand({ Marker: marker }),
            getAwsCommandOptions(options),
          ),
        (response) => response.GlobalClusters,
        (response) => response.Marker,
      );
      for (const globalCluster of globalClusters) {
        const globalTags = globalCluster.GlobalClusterArn
          ? await fetchAwsTagsWithRetry(
              () =>
                rds.send(
                  new ListTagsForResourceCommand({ ResourceName: globalCluster.GlobalClusterArn! }),
                  getAwsCommandOptions(options),
                ),
              (response) => tagsArrayToMap(response.TagList),
              {
                description: `Aurora tag discovery unavailable in ${options.region}`,
                warnings,
                warningDeduper: tagWarnings,
              },
            )
          : {};
        resources.push(buildAuroraGlobal(globalCluster, accountContext, globalTags));
      }
    } catch {
      warnings.push(`Aurora global cluster discovery unavailable in ${options.region}.`);
    }
  }

  return { resources, warnings };
}
