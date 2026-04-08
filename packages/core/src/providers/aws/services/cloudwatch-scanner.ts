/**
 * Scans CloudWatch alarms and the resources they monitor.
 */

import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-cloudwatch';
import type { Dimension, MetricAlarm } from '@aws-sdk/client-cloudwatch';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { buildResource } from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, tagsArrayToMap } from '../tag-utils.js';

const MONITORED_DIMENSION_NAMES = new Set([
  'InstanceId',
  'DBInstanceIdentifier',
  'DBClusterIdentifier',
  'FunctionName',
  'TableName',
  'QueueName',
  'TopicName',
  'LoadBalancer',
  'LoadBalancerName',
  'VpcId',
]);

function toAlarmDimensions(
  dimensions: readonly Dimension[] | undefined,
): readonly Record<string, string>[] {
  return (dimensions ?? [])
    .filter((dimension): dimension is Dimension => Boolean(dimension.Name && dimension.Value))
    .map((dimension) => ({
      name: dimension.Name!,
      value: dimension.Value!,
    }));
}

function extractMonitoredReferences(dimensions: readonly Dimension[] | undefined): readonly string[] {
  return (dimensions ?? [])
    .filter(
      (dimension): dimension is Dimension =>
        Boolean(dimension.Name && dimension.Value) && MONITORED_DIMENSION_NAMES.has(dimension.Name!),
    )
    .map((dimension) => dimension.Value!)
    .filter((value, index, items) => items.indexOf(value) === index);
}

async function listMetricAlarms(
  cloudwatch: CloudWatchClient,
  options: AwsClientOptions,
): Promise<readonly MetricAlarm[]> {
  const alarms: MetricAlarm[] = [];
  let nextToken: string | undefined;

  do {
    const response = await cloudwatch.send(
      new DescribeAlarmsCommand({
        AlarmTypes: ['MetricAlarm'],
        NextToken: nextToken,
      }),
      getAwsCommandOptions(options),
    );
    alarms.push(...(response.MetricAlarms ?? []));
    nextToken = response.NextToken;
  } while (nextToken);

  return alarms;
}

export async function scanCloudWatchAlarms(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const cloudwatch = createAwsClient(CloudWatchClient, options);
  const warnings: string[] = [];
  const tagWarnings = new Set<string>();
  const alarms = await listMetricAlarms(cloudwatch, options);
  const resources: DiscoveredResource[] = [];

  for (const alarm of alarms) {
    const tags = alarm.AlarmArn
      ? await fetchAwsTagsWithRetry(
          () =>
            cloudwatch.send(
              new ListTagsForResourceCommand({ ResourceARN: alarm.AlarmArn! }),
              getAwsCommandOptions(options),
            ),
          (response) => tagsArrayToMap(response.Tags),
          {
            description: `CloudWatch tag discovery unavailable in ${options.region}`,
            warnings,
            warningDeduper: tagWarnings,
          },
        )
      : {};
    const displayName = getNameTag(tags) ?? alarm.AlarmName ?? 'alarm';

    resources.push(buildResource({
      source: 'aws',
      externalId: alarm.AlarmArn ?? `cloudwatch-alarm:${alarm.AlarmName ?? 'alarm'}`,
      name: displayName,
      kind: 'infra',
      type: 'CLOUDWATCH_ALARM',
      tags,
      metadata: {
        region: options.region,
        alarmArn: alarm.AlarmArn,
        alarmName: alarm.AlarmName,
        namespace: alarm.Namespace,
        metricName: alarm.MetricName,
        dimensions: toAlarmDimensions(alarm.Dimensions),
        monitoredReferences: extractMonitoredReferences(alarm.Dimensions),
        threshold: alarm.Threshold,
        comparisonOperator: alarm.ComparisonOperator,
        evaluationPeriods: alarm.EvaluationPeriods,
        actionsEnabled: alarm.ActionsEnabled ?? false,
        alarmActions: (alarm.AlarmActions ?? []).filter((value): value is string => Boolean(value)),
        state: alarm.StateValue,
        displayName,
        ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
      },
    }));
  }

  return { resources, warnings };
}
