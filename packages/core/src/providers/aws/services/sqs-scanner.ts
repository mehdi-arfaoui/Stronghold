/**
 * Scans AWS SQS queues.
 */

import {
  SQSClient,
  ListQueuesCommand,
  GetQueueAttributesCommand,
  ListQueueTagsCommand,
} from '@aws-sdk/client-sqs';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, createResource } from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, normalizeTagMap } from '../tag-utils.js';

function parseRedrivePolicy(rawPolicy: string | undefined): Record<string, unknown> | undefined {
  if (!rawPolicy || rawPolicy.trim().length === 0) return undefined;
  try {
    return JSON.parse(rawPolicy) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function extractDeadLetterArn(redrivePolicy: Record<string, unknown> | undefined): string | undefined {
  return typeof redrivePolicy?.deadLetterTargetArn === 'string'
    ? redrivePolicy.deadLetterTargetArn
    : undefined;
}

function extractMaxReceiveCount(
  redrivePolicy: Record<string, unknown> | undefined,
): number | undefined {
  const value = Number(redrivePolicy?.maxReceiveCount);
  return Number.isFinite(value) ? value : undefined;
}

export async function scanSqsQueues(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const sqs = createAwsClient(SQSClient, options);
  const warnings: string[] = [];
  const tagWarnings = new Set<string>();

  const queueUrls = await paginateAws(
    (nextToken) =>
      sqs.send(new ListQueuesCommand({ NextToken: nextToken }), getAwsCommandOptions(options)),
    (response) => response.QueueUrls,
    (response) => response.NextToken,
  );

  const resources: DiscoveredResource[] = [];

  for (const queueUrl of queueUrls) {
    const queueAttributes = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['All'] }),
      getAwsCommandOptions(options),
    );
    const attrs = queueAttributes.Attributes ?? {};
    const queueArn = attrs.QueueArn ?? queueUrl;
    const queueName = queueArn.split(':').pop() ?? queueUrl.split('/').pop() ?? 'queue';
    const redrivePolicy = parseRedrivePolicy(attrs.RedrivePolicy);
    const tags = await fetchAwsTagsWithRetry(
      () =>
        sqs.send(new ListQueueTagsCommand({ QueueUrl: queueUrl }), getAwsCommandOptions(options)),
      (response) => normalizeTagMap(response.Tags),
      {
        description: `SQS tag discovery unavailable in ${options.region}`,
        warnings,
        warningDeduper: tagWarnings,
      },
    );
    const displayName = getNameTag(tags) ?? queueName;

    resources.push(
      createResource({
        source: 'aws',
        arn: queueArn,
        name: displayName,
        kind: 'infra',
        type: 'SQS_QUEUE',
        tags,
        metadata: {
          region: options.region,
          queueUrl,
          queueArn,
          queueName,
          fifoQueue: attrs.FifoQueue === 'true',
          visibilityTimeout: attrs.VisibilityTimeout ? Number(attrs.VisibilityTimeout) : undefined,
          messageRetentionSeconds: attrs.MessageRetentionPeriod
            ? Number(attrs.MessageRetentionPeriod)
            : undefined,
          kmsMasterKeyId: attrs.KmsMasterKeyId ?? undefined,
          redrivePolicy: redrivePolicy ?? undefined,
          redrivePolicyRaw: attrs.RedrivePolicy ?? undefined,
          deadLetterTargetArn: extractDeadLetterArn(redrivePolicy),
          dlqArn: extractDeadLetterArn(redrivePolicy),
          maxReceiveCount: extractMaxReceiveCount(redrivePolicy),
          displayName,
          ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
        },
      }),
    );
  }

  return { resources, warnings };
}
