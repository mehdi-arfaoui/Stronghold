import { describe, expect, it } from 'vitest';
import type { InfraNodeAttrs } from '../../../types/infrastructure.js';
import { runValidation } from '../../validation-engine.js';
import type { ValidationEdge, WeightedValidationResult } from '../../validation-types.js';
import { lambdaValidationRules } from '../lambda-rules.js';

const FUNCTION_ARN = 'arn:aws:lambda:eu-west-3:123456789012:function:worker';
const SQS_ARN = 'arn:aws:sqs:eu-west-3:123456789012:jobs';
const DLQ_ARN = 'arn:aws:sqs:eu-west-3:123456789012:worker-dlq';
const DDB_STREAM_ARN =
  'arn:aws:dynamodb:eu-west-3:123456789012:table/orders/stream/2026-04-01T00:00:00.000';
const KINESIS_STREAM_ARN = 'arn:aws:kinesis:eu-west-3:123456789012:stream/events';

function createNode(metadata: Record<string, unknown> = {}): InfraNodeAttrs {
  return {
    id: FUNCTION_ARN,
    name: 'worker',
    type: 'SERVERLESS',
    provider: 'aws',
    region: 'eu-west-3',
    availabilityZone: null,
    tags: {},
    metadata: {
      sourceType: 'LAMBDA',
      functionArn: FUNCTION_ARN,
      functionName: 'worker',
      deadLetterConfig: null,
      deadLetterTargetArn: null,
      asyncInvokeConfig: null,
      eventSourceMappings: [],
      reservedConcurrency: null,
      provisionedConcurrency: null,
      provisionedConcurrencyConfigs: [],
      ...metadata,
    },
  };
}

function sqsMapping(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: 'esm-sqs',
    eventSourceArn: SQS_ARN,
    state: 'Enabled',
    batchSize: 10,
    maximumRetryAttempts: null,
    bisectBatchOnFunctionError: null,
    destinationConfig: null,
    functionResponseTypes: [],
    ...metadata,
  };
}

function streamMapping(
  eventSourceArn: string,
  metadata: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    uuid: 'esm-stream',
    eventSourceArn,
    state: 'Enabled',
    batchSize: 100,
    maximumRetryAttempts: 3,
    bisectBatchOnFunctionError: false,
    destinationConfig: null,
    functionResponseTypes: [],
    ...metadata,
  };
}

function executeRule(
  ruleId: string,
  nodes: readonly InfraNodeAttrs[],
  edges: readonly ValidationEdge[] = [],
): WeightedValidationResult {
  const report = runValidation(nodes, edges, lambdaValidationRules);
  const result = report.results.find(
    (entry) => entry.ruleId === ruleId && entry.nodeId === FUNCTION_ARN,
  );
  if (!result) throw new Error(`Missing result for ${ruleId}`);
  return result;
}

describe('Lambda DR Rules', () => {
  it('flags async lambda without DLQ as high', () => {
    const result = executeRule('LAMBDA_NO_DLQ', [
      createNode({ eventSourceMappings: [sqsMapping()] }),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('high');
  });

  it('passes lambda with DLQ configured', () => {
    const result = executeRule('LAMBDA_NO_DLQ', [
      createNode({
        deadLetterConfig: { targetArn: DLQ_ARN },
        deadLetterTargetArn: DLQ_ARN,
        eventSourceMappings: [sqsMapping()],
      }),
    ]);

    expect(result.status).toBe('pass');
  });

  it('passes lambda with onFailure destination instead of DLQ', () => {
    const result = executeRule('LAMBDA_NO_DLQ', [
      createNode({
        asyncInvokeConfig: {
          maximumRetryAttempts: 2,
          maximumEventAgeInSeconds: 21_600,
          destinationConfig: {
            onSuccess: null,
            onFailure: { destination: DLQ_ARN },
          },
        },
      }),
    ]);

    expect(result.status).toBe('pass');
  });

  it('flags disabled event source mapping', () => {
    const result = executeRule('LAMBDA_EVENT_SOURCE_DISABLED', [
      createNode({ eventSourceMappings: [sqsMapping({ state: 'Disabled' })] }),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('medium');
  });

  it('flags critical lambda without reserved concurrency', () => {
    const result = executeRule('LAMBDA_NO_RESERVED_CONCURRENCY', [
      createNode({ criticality: 'critical' }),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('medium');
  });

  it('passes non-critical lambda without reserved concurrency', () => {
    const result = executeRule('LAMBDA_NO_RESERVED_CONCURRENCY', [createNode()]);

    expect(result.status).toBe('pass');
  });

  it('flags provisioned concurrency that is not ready', () => {
    const result = executeRule('LAMBDA_PROVISIONED_NOT_READY', [
      createNode({
        provisionedConcurrency: {
          allocatedConcurrency: 0,
          availableConcurrency: 0,
          status: 'IN_PROGRESS',
          aliasOrVersion: 'live',
        },
      }),
    ]);

    expect(result.status).toBe('fail');
  });

  it('flags DynamoDB stream ESM without bisect', () => {
    const result = executeRule('LAMBDA_ESM_NO_BISECT', [
      createNode({ eventSourceMappings: [streamMapping(DDB_STREAM_ARN)] }),
    ]);

    expect(result.status).toBe('fail');
  });

  it('passes ESM with ReportBatchItemFailures', () => {
    const result = executeRule('LAMBDA_ESM_NO_BISECT', [
      createNode({
        eventSourceMappings: [
          streamMapping(KINESIS_STREAM_ARN, {
            functionResponseTypes: ['ReportBatchItemFailures'],
          }),
        ],
      }),
    ]);

    expect(result.status).toBe('pass');
  });
});
