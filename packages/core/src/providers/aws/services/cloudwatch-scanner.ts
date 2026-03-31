/**
 * Scans CloudWatch alarms and the resources they monitor.
 */

import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import type { Dimension, MetricAlarm } from '@aws-sdk/client-cloudwatch';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, type AwsClientOptions } from '../aws-client-factory.js';
import { buildResource } from '../scan-utils.js';

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

async function listMetricAlarms(options: AwsClientOptions): Promise<readonly MetricAlarm[]> {
  const cloudwatch = createAwsClient(CloudWatchClient, options);
  const alarms: MetricAlarm[] = [];
  let nextToken: string | undefined;

  do {
    const response = await cloudwatch.send(
      new DescribeAlarmsCommand({
        AlarmTypes: ['MetricAlarm'],
        NextToken: nextToken,
      }),
    );
    alarms.push(...(response.MetricAlarms ?? []));
    nextToken = response.NextToken;
  } while (nextToken);

  return alarms;
}

export async function scanCloudWatchAlarms(
  options: AwsClientOptions,
): Promise<DiscoveredResource[]> {
  const alarms = await listMetricAlarms(options);

  return alarms.map((alarm) =>
    buildResource({
      source: 'aws',
      externalId: alarm.AlarmArn ?? `cloudwatch-alarm:${alarm.AlarmName ?? 'alarm'}`,
      name: alarm.AlarmName ?? 'alarm',
      kind: 'infra',
      type: 'CLOUDWATCH_ALARM',
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
        displayName: alarm.AlarmName ?? 'alarm',
      },
    }),
  );
}
