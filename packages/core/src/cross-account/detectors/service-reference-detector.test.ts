import { describe, expect, it } from 'vitest';

import { ServiceReferenceDetector } from './service-reference-detector.js';
import {
  addTestNode,
  createAccountResults,
  createTestGraph,
} from '../test-helpers.js';

const SOURCE_ACCOUNT_ID = '111122223333';
const TARGET_ACCOUNT_ID = '444455556666';
const REGION = 'eu-west-1';

describe('ServiceReferenceDetector', () => {
  it('detects ECS task definition cross-account roles, ECR images, and secrets', () => {
    const graph = createTestGraph();
    const taskDefinitionArn =
      `arn:aws:ecs:${REGION}:${SOURCE_ACCOUNT_ID}:task-definition/payments:4`;
    addTestNode(graph, {
      arn: taskDefinitionArn,
      accountId: SOURCE_ACCOUNT_ID,
      type: 'CONTAINER',
      sourceType: 'ECS_TASK_DEFINITION',
      metadata: {
        taskRoleArn: `arn:aws:iam::${TARGET_ACCOUNT_ID}:role/shared-task-role`,
        executionRoleArn: `arn:aws:iam::${TARGET_ACCOUNT_ID}:role/shared-exec-role`,
        ecrImageReferences: [
          {
            repositoryArn:
              `arn:aws:ecr:${REGION}:${TARGET_ACCOUNT_ID}:repository/payments/api`,
          },
        ],
        secretReferences: [
          {
            targetArn:
              `arn:aws:secretsmanager:${REGION}:${TARGET_ACCOUNT_ID}:secret:db-AbCdEf`,
          },
        ],
      },
    });

    const result = new ServiceReferenceDetector().detect(
      graph,
      createAccountResults([SOURCE_ACCOUNT_ID, TARGET_ACCOUNT_ID]),
    );

    expect(referenceTypes(result)).toEqual([
      'ecs_ecr_image',
      'ecs_execution_role',
      'ecs_secret',
      'ecs_task_role',
    ]);
  });

  it('detects Lambda event source and DLQ references in another account', () => {
    const graph = createTestGraph();
    const lambdaArn = `arn:aws:lambda:${REGION}:${SOURCE_ACCOUNT_ID}:function:payments-worker`;
    addTestNode(graph, {
      arn: lambdaArn,
      accountId: SOURCE_ACCOUNT_ID,
      type: 'SERVERLESS',
      sourceType: 'LAMBDA',
      metadata: {
        deadLetterTargetArn: `arn:aws:sqs:${REGION}:${TARGET_ACCOUNT_ID}:payments-dlq`,
        eventSourceMappings: [
          {
            eventSourceArn: `arn:aws:sqs:${REGION}:${TARGET_ACCOUNT_ID}:payments-events`,
          },
        ],
      },
    });

    const result = new ServiceReferenceDetector().detect(
      graph,
      createAccountResults([SOURCE_ACCOUNT_ID, TARGET_ACCOUNT_ID]),
    );

    expect(referenceTypes(result)).toEqual(['lambda_dead_letter', 'lambda_event_source']);
  });

  it('detects EventBridge target references in another account', () => {
    const graph = createTestGraph();
    const targetResourceArn =
      `arn:aws:events:${REGION}:${SOURCE_ACCOUNT_ID}:target/payments-rule/lambda`;
    addTestNode(graph, {
      arn: targetResourceArn,
      accountId: SOURCE_ACCOUNT_ID,
      type: 'MESSAGE_QUEUE',
      sourceType: 'EVENTBRIDGE_TARGET',
      metadata: {
        targetArn: `arn:aws:lambda:${REGION}:${TARGET_ACCOUNT_ID}:function:shared-handler`,
        roleArn: `arn:aws:iam::${TARGET_ACCOUNT_ID}:role/eventbridge-target-role`,
        deadLetterConfig: {
          arn: `arn:aws:sqs:${REGION}:${TARGET_ACCOUNT_ID}:eventbridge-dlq`,
        },
      },
    });

    const result = new ServiceReferenceDetector().detect(
      graph,
      createAccountResults([SOURCE_ACCOUNT_ID, TARGET_ACCOUNT_ID]),
    );

    expect(referenceTypes(result)).toEqual([
      'eventbridge_target',
      'eventbridge_target_dead_letter',
      'service_role',
    ]);
  });

  it('detects Step Functions task resources in another account', () => {
    const graph = createTestGraph();
    const stateMachineArn =
      `arn:aws:states:${REGION}:${SOURCE_ACCOUNT_ID}:stateMachine:payments-flow`;
    addTestNode(graph, {
      arn: stateMachineArn,
      accountId: SOURCE_ACCOUNT_ID,
      type: 'SERVERLESS',
      sourceType: 'SFN_STATE_MACHINE',
      metadata: {
        definitionResourceArns: [
          `arn:aws:lambda:${REGION}:${TARGET_ACCOUNT_ID}:function:shared-handler`,
        ],
      },
    });

    const result = new ServiceReferenceDetector().detect(
      graph,
      createAccountResults([SOURCE_ACCOUNT_ID, TARGET_ACCOUNT_ID]),
    );

    expect(referenceTypes(result)).toEqual(['stepfunctions_task_resource']);
  });
});

function referenceTypes(
  edges: ReturnType<ServiceReferenceDetector['detect']>,
): readonly string[] {
  return edges
    .map((edge) =>
      edge.metadata.kind === 'service_reference' ? edge.metadata.referenceType : '',
    )
    .filter((entry) => entry.length > 0)
    .sort();
}
