/**
 * Scans AWS Auto Scaling groups.
 */

import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from '@aws-sdk/client-auto-scaling';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { getNameTag, tagsArrayToMap } from '../tag-utils.js';
import {
  createAccountContextResolver,
  createResource,
  paginateAws,
} from '../scan-utils.js';

export async function scanAutoScalingGroups(
  options: AwsClientOptions,
): Promise<DiscoveredResource[]> {
  const asg = createAwsClient(AutoScalingClient, options);
  const resolveAccountContext = createAccountContextResolver(options);

  const groups = await paginateAws(
    (nextToken) =>
      asg.send(
        new DescribeAutoScalingGroupsCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
    (response) => response.AutoScalingGroups,
    (response) => response.NextToken,
  );

  const resources: DiscoveredResource[] = [];

  for (const group of groups) {
    const tags = tagsArrayToMap(group.Tags);
    const displayName = getNameTag(tags) ?? group.AutoScalingGroupName ?? 'asg';
    const accountContext = group.AutoScalingGroupARN ? null : await resolveAccountContext();
    const resolvedAccount = accountContext ?? (await resolveAccountContext());
    const groupArn =
      group.AutoScalingGroupARN ??
      `arn:${resolvedAccount.partition}:autoscaling:${options.region}:${resolvedAccount.accountId}:autoScalingGroup:autoScalingGroupName/${group.AutoScalingGroupName ?? 'asg'}`;

    resources.push(createResource({
      source: 'aws',
      arn: groupArn,
      name: displayName,
      kind: 'infra',
      type: 'ASG',
      ...(accountContext ? { account: accountContext } : {}),
      tags,
      metadata: {
        autoScalingGroupArn: groupArn,
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
    }));
  }

  return resources;
}
