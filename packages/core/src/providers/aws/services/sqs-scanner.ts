/**
 * Scans AWS SQS queues.
 */

import { SQSClient, ListQueuesCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource } from '../scan-utils.js';

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

export async function scanSqsQueues(options: AwsClientOptions): Promise<DiscoveredResource[]> {
  const sqs = createAwsClient(SQSClient, options);

  const queueUrls = await paginateAws(
    (nextToken) => sqs.send(new ListQueuesCommand({ NextToken: nextToken })),
    (response) => response.QueueUrls,
    (response) => response.NextToken,
  );

  const resources: DiscoveredResource[] = [];

  for (const queueUrl of queueUrls) {
    const queueAttributes = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['All'] }),
    );
    const attrs = queueAttributes.Attributes ?? {};
    const queueArn = attrs.QueueArn ?? queueUrl;
    const queueName = queueArn.split(':').pop() ?? queueUrl.split('/').pop() ?? 'queue';
    const redrivePolicy = parseRedrivePolicy(attrs.RedrivePolicy);

    resources.push(
      buildResource({
        source: 'aws',
        externalId: queueArn,
        name: queueName,
        kind: 'infra',
        type: 'SQS_QUEUE',
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
          displayName: queueName,
        },
      }),
    );
  }

  return resources;
}
