/**
 * Scans AWS ElastiCache clusters and replication groups.
 */

import {
  ElastiCacheClient,
  DescribeCacheClustersCommand,
  DescribeReplicationGroupsCommand,
} from '@aws-sdk/client-elasticache';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource } from '../scan-utils.js';

export async function scanElastiCacheClusters(
  options: AwsClientOptions,
): Promise<DiscoveredResource[]> {
  const elasticache = createAwsClient(ElastiCacheClient, options);

  const replicationGroups = await paginateAws(
    (marker) =>
      elasticache.send(
        new DescribeReplicationGroupsCommand({ Marker: marker }),
        getAwsCommandOptions(options),
      ),
    (response) => response.ReplicationGroups,
    (response) => response.Marker,
  );

  const memberCountByGroup = new Map<string, number>();
  for (const group of replicationGroups) {
    if (!group.ReplicationGroupId) continue;
    memberCountByGroup.set(group.ReplicationGroupId, group.MemberClusters?.length ?? 0);
  }

  const cacheClusters = await paginateAws(
    (marker) =>
      elasticache.send(
        new DescribeCacheClustersCommand({ ShowCacheNodeInfo: true, Marker: marker }),
        getAwsCommandOptions(options),
      ),
    (response) => response.CacheClusters,
    (response) => response.Marker,
  );

  return cacheClusters.map((cluster) => {
    const clusterId = cluster.CacheClusterId ?? 'elasticache';
    const replicationGroupId = cluster.ReplicationGroupId;
    const groupClusterCount = replicationGroupId
      ? (memberCountByGroup.get(replicationGroupId) ?? 0)
      : 0;
    const replicaCount = groupClusterCount > 0 ? Math.max(0, groupClusterCount - 1) : 0;

    return buildResource({
      source: 'aws',
      externalId: cluster.ARN ?? clusterId,
      name: clusterId,
      kind: 'infra',
      type: 'ELASTICACHE',
      metadata: {
        region: options.region,
        cacheClusterId: clusterId,
        cacheClusterArn: cluster.ARN,
        engine: cluster.Engine,
        status: cluster.CacheClusterStatus,
        cacheNodeType: cluster.CacheNodeType,
        numCacheNodes: cluster.NumCacheNodes ?? undefined,
        num_cache_nodes: cluster.NumCacheNodes ?? undefined,
        replicationGroupId: replicationGroupId ?? undefined,
        replicationGroup: replicationGroupId ?? undefined,
        replicaCount,
        availabilityZone: cluster.PreferredAvailabilityZone,
        subnetGroup: cluster.CacheSubnetGroupName,
        securityGroups: (cluster.SecurityGroups ?? [])
          .map((group) => group.SecurityGroupId)
          .filter((groupId): groupId is string => Boolean(groupId)),
        endpointAddress:
          cluster.ConfigurationEndpoint?.Address ?? cluster.CacheNodes?.[0]?.Endpoint?.Address,
        endpointPort:
          cluster.ConfigurationEndpoint?.Port ?? cluster.CacheNodes?.[0]?.Endpoint?.Port,
        configurationEndpoint: cluster.ConfigurationEndpoint?.Address,
        primaryEndpoint: cluster.CacheNodes?.[0]?.Endpoint?.Address,
        displayName: clusterId,
      },
    });
  });
}
