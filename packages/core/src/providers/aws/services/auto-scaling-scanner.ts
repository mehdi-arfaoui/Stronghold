/**
 * Scans AWS Auto Scaling groups.
 */

import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from '@aws-sdk/client-auto-scaling';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { getNameTag, tagsArrayToMap } from '../tag-utils.js';
import { paginateAws, buildResource } from '../scan-utils.js';

export async function scanAutoScalingGroups(
  options: AwsClientOptions,
): Promise<DiscoveredResource[]> {
  const asg = createAwsClient(AutoScalingClient, options);

  const groups = await paginateAws(
    (nextToken) =>
      asg.send(
        new DescribeAutoScalingGroupsCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
    (response) => response.AutoScalingGroups,
    (response) => response.NextToken,
  );

  return groups.map((group) => {
    const tags = tagsArrayToMap(group.Tags);
    const displayName = getNameTag(tags) ?? group.AutoScalingGroupName ?? 'asg';

    return buildResource({
      source: 'aws',
      externalId: group.AutoScalingGroupARN ?? group.AutoScalingGroupName ?? 'asg',
      name: displayName,
      kind: 'infra',
      type: 'ASG',
      tags,
      metadata: {
        autoScalingGroupArn: group.AutoScalingGroupARN,
        autoScalingGroupName: group.AutoScalingGroupName,
        minSize: group.MinSize,
        maxSize: group.MaxSize,
        region: options.region,
        desiredCapacity: group.DesiredCapacity,
        subnetIds: (group.VPCZoneIdentifier ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
        availabilityZones: (group.AvailabilityZones ?? []).filter(
          (value): value is string => Boolean(value),
        ),
        displayName,
        ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
      },
    });
  });
}
