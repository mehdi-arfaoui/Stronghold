/**
 * Scans AWS EKS clusters and node groups.
 */

import {
  EKSClient,
  ListClustersCommand,
  DescribeClusterCommand,
  ListNodegroupsCommand,
  DescribeNodegroupCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-eks';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource } from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, normalizeTagMap } from '../tag-utils.js';

export async function scanEksClusters(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const eks = createAwsClient(EKSClient, options);
  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  const tagWarnings = new Set<string>();

  const clusterNames = await paginateAws(
    (nextToken) => eks.send(new ListClustersCommand({ nextToken }), getAwsCommandOptions(options)),
    (response) => response.clusters,
    (response) => response.nextToken,
  );

  for (const clusterName of clusterNames) {
    const clusterDetails = await eks.send(
      new DescribeClusterCommand({ name: clusterName }),
      getAwsCommandOptions(options),
    );
    const cluster = clusterDetails.cluster;
    if (!cluster) continue;
    const fetchedClusterTags = cluster.arn
      ? await fetchAwsTagsWithRetry(
          () =>
            eks.send(
              new ListTagsForResourceCommand({ resourceArn: cluster.arn! }),
              getAwsCommandOptions(options),
            ),
          (response) => normalizeTagMap(response.tags),
          {
            description: `EKS tag discovery unavailable in ${options.region}`,
            warnings,
            warningDeduper: tagWarnings,
          },
        )
      : {};
    const clusterTags =
      Object.keys(fetchedClusterTags).length > 0 ? fetchedClusterTags : normalizeTagMap(cluster.tags);
    const clusterDisplayName = getNameTag(clusterTags) ?? clusterName;

    resources.push(
      buildResource({
        source: 'aws',
        externalId: cluster.arn ?? clusterName,
        name: clusterDisplayName,
        kind: 'infra',
        type: 'EKS',
        tags: clusterTags,
        metadata: {
          region: options.region,
          version: cluster.version,
          status: cluster.status,
          endpoint: cluster.endpoint,
          platformVersion: cluster.platformVersion,
          vpcId: cluster.resourcesVpcConfig?.vpcId,
          subnetIds: (cluster.resourcesVpcConfig?.subnetIds ?? []).filter(
            (subnetId): subnetId is string => Boolean(subnetId),
          ),
          clusterArn: cluster.arn,
          clusterName,
          displayName: clusterDisplayName,
          ...(Object.keys(clusterTags).length > 0 ? { awsTags: clusterTags } : {}),
        },
      }),
    );

    const nodeGroupList = await eks.send(
      new ListNodegroupsCommand({ clusterName }),
      getAwsCommandOptions(options),
    );
    for (const nodeGroupName of nodeGroupList.nodegroups ?? []) {
      const ngDetails = await eks.send(
        new DescribeNodegroupCommand({ clusterName, nodegroupName: nodeGroupName }),
        getAwsCommandOptions(options),
      );
      const nodeGroup = ngDetails.nodegroup;
      if (!nodeGroup) continue;
      const nodeGroupTags = normalizeTagMap(nodeGroup.tags);
      const nodeGroupDisplayName = getNameTag(nodeGroupTags) ?? `${clusterName}/${nodeGroupName}`;

      resources.push(
        buildResource({
          source: 'aws',
          externalId: nodeGroup.nodegroupArn ?? `${clusterName}/${nodeGroupName}`,
          name: nodeGroupDisplayName,
          kind: 'infra',
          type: 'EKS_NODEGROUP',
          tags: nodeGroupTags,
          metadata: {
            region: options.region,
            clusterName,
            nodegroupArn: nodeGroup.nodegroupArn,
            nodegroupName: nodeGroupName,
            status: nodeGroup.status,
            capacityType: nodeGroup.capacityType,
            instanceTypes: nodeGroup.instanceTypes,
            desiredSize: nodeGroup.scalingConfig?.desiredSize,
            minSize: nodeGroup.scalingConfig?.minSize,
            maxSize: nodeGroup.scalingConfig?.maxSize,
            displayName: nodeGroupDisplayName,
            ...(Object.keys(nodeGroupTags).length > 0 ? { awsTags: nodeGroupTags } : {}),
          },
        }),
      );
    }
  }

  return { resources, warnings };
}
