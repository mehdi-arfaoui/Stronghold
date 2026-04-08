/**
 * Scans AWS SNS topics and subscriptions.
 */

import {
  SNSClient,
  ListTopicsCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-sns';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource } from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, tagsArrayToMap } from '../tag-utils.js';

export async function scanSnsTopics(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const sns = createAwsClient(SNSClient, options);
  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  const tagWarnings = new Set<string>();

  const topicList = await paginateAws(
    (nextToken) =>
      sns.send(new ListTopicsCommand({ NextToken: nextToken }), getAwsCommandOptions(options)),
    (response) => response.Topics,
    (response) => response.NextToken,
  );

  for (const topic of topicList) {
    if (!topic.TopicArn) continue;
    const attributes = await sns.send(
      new GetTopicAttributesCommand({ TopicArn: topic.TopicArn }),
      getAwsCommandOptions(options),
    );
    const attrs = attributes.Attributes ?? {};
    const topicName = topic.TopicArn.split(':').pop() ?? 'topic';
    const tags = await fetchAwsTagsWithRetry(
      () =>
        sns.send(
          new ListTagsForResourceCommand({ ResourceArn: topic.TopicArn! }),
          getAwsCommandOptions(options),
        ),
      (response) => tagsArrayToMap(response.Tags),
      {
        description: `SNS tag discovery unavailable in ${options.region}`,
        warnings,
        warningDeduper: tagWarnings,
      },
    );
    const displayName = getNameTag(tags) ?? topicName;
    let subscriptions: Array<{ protocol: string; endpoint: string }> = [];

    try {
      const subsResult = await paginateAws(
        (nextToken) =>
          sns.send(
            new ListSubscriptionsByTopicCommand({
              TopicArn: topic.TopicArn,
              NextToken: nextToken,
            }),
            getAwsCommandOptions(options),
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
        name: displayName,
        kind: 'infra',
        type: 'SNS_TOPIC',
        tags,
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
          displayName,
          ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
        },
      }),
    );
  }

  return { resources, warnings };
}
