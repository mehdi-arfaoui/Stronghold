/**
 * Scans AWS ElastiCache clusters and replication groups.
 */

import {
  ElastiCacheClient,
  DescribeCacheClustersCommand,
  DescribeReplicationGroupsCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-elasticache';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { addWarningOnce, fetchAwsTagsWithRetry, getNameTag, tagsArrayToMap } from '../tag-utils.js';
import { getCallerIdentity } from '../get-caller-identity.js';
import { paginateAws, buildResource } from '../scan-utils.js';

export async function scanElastiCacheClusters(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const elasticache = createAwsClient(ElastiCacheClient, options);
  const warnings: string[] = [];
  const tagWarnings = new Set<string>();

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

  let accountIdPromise: Promise<string | null> | null = null;
  const resolveAccountId = async (): Promise<string | null> => {
    if (!accountIdPromise) {
      accountIdPromise = getCallerIdentity({
        ...options.credentials,
        region: options.region,
      }).then((identity) => identity?.accountId ?? null);
    }
    return accountIdPromise;
  };

  const resources: DiscoveredResource[] = [];

  for (const cluster of cacheClusters) {
    const clusterId = cluster.CacheClusterId ?? 'elasticache';
    const replicationGroupId = cluster.ReplicationGroupId;
    const groupClusterCount = replicationGroupId
      ? (memberCountByGroup.get(replicationGroupId) ?? 0)
      : 0;
    const replicaCount = groupClusterCount > 0 ? Math.max(0, groupClusterCount - 1) : 0;
    let resourceArn = cluster.ARN;
    if (!resourceArn && clusterId) {
      const accountId = await resolveAccountId();
      if (accountId) {
        resourceArn = `arn:aws:elasticache:${options.region}:${accountId}:cluster:${clusterId}`;
      } else {
        addWarningOnce(
          warnings,
          tagWarnings,
          `elasticache-missing-account:${options.region}`,
          `ElastiCache tag discovery unavailable in ${options.region} (MissingAccountId). Continuing without tags.`,
        );
      }
    }
    const tags = resourceArn
      ? await fetchAwsTagsWithRetry(
          () =>
            elasticache.send(
              new ListTagsForResourceCommand({ ResourceName: resourceArn! }),
              getAwsCommandOptions(options),
            ),
          (response) => tagsArrayToMap(response.TagList),
          {
            description: `ElastiCache tag discovery unavailable in ${options.region}`,
            warnings,
            warningDeduper: tagWarnings,
          },
        )
      : {};
    const displayName = getNameTag(tags) ?? clusterId;

    resources.push(buildResource({
      source: 'aws',
      externalId: cluster.ARN ?? clusterId,
      name: displayName,
      kind: 'infra',
      type: 'ELASTICACHE',
      tags,
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
        displayName,
        ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
      },
    }));
  }

  return { resources, warnings };
}
