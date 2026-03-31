/**
 * Scans AWS SNS topics and subscriptions.
 */

import {
  SNSClient,
  ListTopicsCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
} from '@aws-sdk/client-sns';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource } from '../scan-utils.js';

export async function scanSnsTopics(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const sns = createAwsClient(SNSClient, options);
  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];

  const topicList = await paginateAws(
    (nextToken) => sns.send(new ListTopicsCommand({ NextToken: nextToken })),
    (response) => response.Topics,
    (response) => response.NextToken,
  );

  for (const topic of topicList) {
    if (!topic.TopicArn) continue;
    const attributes = await sns.send(new GetTopicAttributesCommand({ TopicArn: topic.TopicArn }));
    const attrs = attributes.Attributes ?? {};
    const topicName = topic.TopicArn.split(':').pop() ?? 'topic';
    let subscriptions: Array<{ protocol: string; endpoint: string }> = [];

    try {
      const subsResult = await paginateAws(
        (nextToken) =>
          sns.send(
            new ListSubscriptionsByTopicCommand({
              TopicArn: topic.TopicArn,
              NextToken: nextToken,
            }),
          ),
        (response) => response.Subscriptions,
        (response) => response.NextToken,
      );
      subscriptions = subsResult
        .map((sub) => ({
          protocol: String(sub.Protocol ?? '').toLowerCase(),
          endpoint: String(sub.Endpoint ?? ''),
        }))
        .filter(
          (sub) => Boolean(sub.endpoint) && (sub.protocol === 'lambda' || sub.protocol === 'sqs'),
        );
    } catch {
      warnings.push(`SNS subscriptions unavailable for topic ${topicName} in ${options.region}.`);
    }

    resources.push(
      buildResource({
        source: 'aws',
        externalId: topic.TopicArn,
        name: topicName,
        kind: 'infra',
        type: 'SNS_TOPIC',
        metadata: {
          region: options.region,
          topicArn: topic.TopicArn,
          topicName,
          fifoTopic: attrs.FifoTopic === 'true',
          kmsMasterKeyId: attrs.KmsMasterKeyId ?? undefined,
          subscriptionsConfirmed: attrs.SubscriptionsConfirmed
            ? Number(attrs.SubscriptionsConfirmed)
            : undefined,
          subscriptionsPending: attrs.SubscriptionsPending
            ? Number(attrs.SubscriptionsPending)
            : undefined,
          subscriptionsDeleted: attrs.SubscriptionsDeleted
            ? Number(attrs.SubscriptionsDeleted)
            : undefined,
          subscriptions,
          displayName: topicName,
        },
      }),
    );
  }

  return { resources, warnings };
}
