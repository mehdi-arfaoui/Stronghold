/**
 * Scans AWS EKS clusters and node groups.
 */

import {
  EKSClient,
  ListClustersCommand,
  DescribeClusterCommand,
  ListNodegroupsCommand,
  DescribeNodegroupCommand,
} from '@aws-sdk/client-eks';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource } from '../scan-utils.js';

export async function scanEksClusters(options: AwsClientOptions): Promise<DiscoveredResource[]> {
  const eks = createAwsClient(EKSClient, options);
  const resources: DiscoveredResource[] = [];

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

    resources.push(
      buildResource({
        source: 'aws',
        externalId: cluster.arn ?? clusterName,
        name: clusterName,
        kind: 'infra',
        type: 'EKS',
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

      resources.push(
        buildResource({
          source: 'aws',
          externalId: nodeGroup.nodegroupArn ?? `${clusterName}/${nodeGroupName}`,
          name: `${clusterName}/${nodeGroupName}`,
          kind: 'infra',
          type: 'EKS_NODEGROUP',
          metadata: {
            region: options.region,
            clusterName,
            status: nodeGroup.status,
            capacityType: nodeGroup.capacityType,
            instanceTypes: nodeGroup.instanceTypes,
            desiredSize: nodeGroup.scalingConfig?.desiredSize,
            minSize: nodeGroup.scalingConfig?.minSize,
            maxSize: nodeGroup.scalingConfig?.maxSize,
          },
        }),
      );
    }
  }

  return resources;
}
