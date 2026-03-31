/**
 * Scans AWS Auto Scaling groups.
 */

import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from '@aws-sdk/client-auto-scaling';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource } from '../scan-utils.js';

export async function scanAutoScalingGroups(
  options: AwsClientOptions,
): Promise<DiscoveredResource[]> {
  const asg = createAwsClient(AutoScalingClient, options);

  const groups = await paginateAws(
    (nextToken) => asg.send(new DescribeAutoScalingGroupsCommand({ NextToken: nextToken })),
    (response) => response.AutoScalingGroups,
    (response) => response.NextToken,
  );

  return groups.map((group) =>
    buildResource({
      source: 'aws',
      externalId: group.AutoScalingGroupARN ?? group.AutoScalingGroupName ?? 'asg',
      name: group.AutoScalingGroupName ?? 'asg',
      kind: 'infra',
      type: 'ASG',
      metadata: {
        minSize: group.MinSize,
        maxSize: group.MaxSize,
        region: options.region,
      },
    }),
  );
}
