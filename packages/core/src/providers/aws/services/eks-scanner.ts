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
import {
  createAccountContextResolver,
  createResource,
  paginateAws,
} from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, normalizeTagMap } from '../tag-utils.js';

export async function scanEksClusters(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const eks = createAwsClient(EKSClient, options);
  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  const tagWarnings = new Set<string>();
  const resolveAccountContext = createAccountContextResolver(options);

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
    const clusterAccountContext = cluster.arn ? null : await resolveAccountContext();
    const resolvedClusterAccount = clusterAccountContext ?? (await resolveAccountContext());
    const clusterArn =
      cluster.arn ??
      `arn:${resolvedClusterAccount.partition}:eks:${options.region}:${resolvedClusterAccount.accountId}:cluster/${clusterName}`;

    resources.push(
      createResource({
        source: 'aws',
        arn: clusterArn,
        name: clusterDisplayName,
        kind: 'infra',
        type: 'EKS',
        ...(clusterAccountContext ? { account: clusterAccountContext } : {}),
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
          clusterArn,
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
      const nodeGroupAccountContext = nodeGroup.nodegroupArn ? null : await resolveAccountContext();
      const resolvedNodeGroupAccount = nodeGroupAccountContext ?? (await resolveAccountContext());
      const nodeGroupArn =
        nodeGroup.nodegroupArn ??
        `arn:${resolvedNodeGroupAccount.partition}:eks:${options.region}:${resolvedNodeGroupAccount.accountId}:nodegroup/${clusterName}/${nodeGroupName}/unknown`;

      resources.push(
        createResource({
          source: 'aws',
          arn: nodeGroupArn,
          name: nodeGroupDisplayName,
          kind: 'infra',
          type: 'EKS_NODEGROUP',
          ...(nodeGroupAccountContext ? { account: nodeGroupAccountContext } : {}),
          tags: nodeGroupTags,
          metadata: {
            region: options.region,
            clusterName,
            nodegroupArn: nodeGroupArn,
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
