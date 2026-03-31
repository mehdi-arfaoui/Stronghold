/**
 * Scans Amazon Aurora clusters, cluster members, and global databases.
 */

import {
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  DescribeGlobalClustersCommand,
  RDSClient,
  type DBCluster,
  type DBClusterMember,
  type DBInstance,
  type GlobalCluster,
} from '@aws-sdk/client-rds';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, type AwsClientOptions } from '../aws-client-factory.js';
import { buildResource, paginateAws } from '../scan-utils.js';

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

function buildAuroraCluster(cluster: DBCluster, region: string): DiscoveredResource {
  const clusterId = cluster.DBClusterIdentifier ?? 'aurora-cluster';
  return buildResource({
    source: 'aws',
    externalId: clusterId,
    name: clusterId,
    kind: 'infra',
    type: 'AURORA_CLUSTER',
    ip: cluster.Endpoint ?? null,
    metadata: {
      region,
      dbClusterIdentifier: clusterId,
      dbClusterArn: cluster.DBClusterArn,
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
      displayName: clusterId,
    },
  });
}

function buildAuroraInstance(
  instance: DBInstance,
  member: DBClusterMember | undefined,
  cluster: DBCluster,
  region: string,
): DiscoveredResource {
  const instanceId = instance.DBInstanceIdentifier ?? 'aurora-instance';
  return buildResource({
    source: 'aws',
    externalId: instanceId,
    name: instanceId,
    kind: 'infra',
    type: 'AURORA_INSTANCE',
    ip: instance.Endpoint?.Address ?? null,
    metadata: {
      region,
      dbInstanceIdentifier: instanceId,
      dbInstanceArn: instance.DBInstanceArn,
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
      displayName: instanceId,
    },
  });
}

function buildAuroraGlobal(globalCluster: GlobalCluster): DiscoveredResource {
  const globalClusterIdentifier = globalCluster.GlobalClusterIdentifier ?? 'aurora-global';
  return buildResource({
    source: 'aws',
    externalId: globalClusterIdentifier,
    name: globalClusterIdentifier,
    kind: 'infra',
    type: 'AURORA_GLOBAL',
    metadata: {
      region: 'global',
      globalClusterIdentifier,
      globalClusterArn: globalCluster.GlobalClusterArn,
      globalClusterMembers: (globalCluster.GlobalClusterMembers ?? []).map((member) => ({
        DBClusterArn: member.DBClusterArn,
        IsWriter: member.IsWriter,
        GlobalWriteForwardingStatus: member.GlobalWriteForwardingStatus,
      })),
      status: globalCluster.Status,
      engine: globalCluster.Engine,
      engineVersion: globalCluster.EngineVersion,
      storageEncrypted: globalCluster.StorageEncrypted,
      displayName: globalClusterIdentifier,
    },
  });
}

async function describeAuroraInstances(
  rds: RDSClient,
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
  const clusters = (
    await paginateAws(
      (marker) => rds.send(new DescribeDBClustersCommand({ Marker: marker })),
      (response) => response.DBClusters,
      (response) => response.Marker,
    )
  ).filter((cluster) => isAuroraEngine(cluster.Engine));

  for (const cluster of clusters) {
    resources.push(buildAuroraCluster(cluster, options.region));

    try {
      const membersById = new Map(
        (cluster.DBClusterMembers ?? [])
          .map((member) => [member.DBInstanceIdentifier, member] as const)
          .filter((entry): entry is readonly [string, DBClusterMember] => Boolean(entry[0])),
      );
      const instances = await describeAuroraInstances(rds, cluster);
      for (const instance of instances) {
        resources.push(
          buildAuroraInstance(
            instance,
            membersById.get(instance.DBInstanceIdentifier ?? ''),
            cluster,
            options.region,
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
        (marker) => rds.send(new DescribeGlobalClustersCommand({ Marker: marker })),
        (response) => response.GlobalClusters,
        (response) => response.Marker,
      );
      resources.push(...globalClusters.map((globalCluster) => buildAuroraGlobal(globalCluster)));
    } catch {
      warnings.push(`Aurora global cluster discovery unavailable in ${options.region}.`);
    }
  }

  return { resources, warnings };
}
