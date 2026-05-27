import { describe, expect, it } from 'vitest';

import { EventBridgeBusPolicyDetector } from './eventbridge-bus-policy-detector.js';
import {
  addTestNode,
  createAccountResults,
  createTestGraph,
} from '../test-helpers.js';

describe('EventBridgeBusPolicyDetector', () => {
  it('detects EventBridge bus policy allowing another account to put events', () => {
    const graph = createTestGraph();
    addEventBus(graph, '111122223333', 'shared-bus', {
      policy: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Sid: 'AllowProducerAccount',
          Effect: 'Allow',
          Action: 'events:PutEvents',
          Principal: {
            AWS: 'arn:aws:iam::444455556666:root',
          },
          Resource: 'arn:aws:events:eu-west-1:111122223333:event-bus/shared-bus',
        },
      }),
    });
    addAccountRoot(graph, '444455556666');

    const result = new EventBridgeBusPolicyDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'eventbridge_bus_policy',
      sourceArn: 'arn:aws:iam::444455556666:root',
      targetArn: 'arn:aws:events:eu-west-1:111122223333:event-bus/shared-bus',
      sourceAccountId: '444455556666',
      targetAccountId: '111122223333',
      completeness: 'complete',
      drImpact: 'critical',
    });
    expect(result[0]?.metadata).toMatchObject({
      kind: 'eventbridge_bus_policy',
      statementId: 'AllowProducerAccount',
      actions: ['events:PutEvents'],
    });
  });

  it('ignores same-account bus policy principals', () => {
    const graph = createTestGraph();
    addEventBus(graph, '111122223333', 'local-bus', {
      policy: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: 'events:PutEvents',
          Principal: {
            AWS: 'arn:aws:iam::111122223333:root',
          },
        },
      }),
    });

    const result = new EventBridgeBusPolicyDetector().detect(
      graph,
      createAccountResults(['111122223333']),
    );

    expect(result).toEqual([]);
  });

  it('uses source account conditions for wildcard principals', () => {
    const graph = createTestGraph();
    addEventBus(graph, '111122223333', 'conditioned-bus', {
      policy: toPolicyDocument({
        Version: '2012-10-17',
        Statement: {
          Effect: 'Allow',
          Action: 'events:*',
          Principal: '*',
          Condition: {
            StringEquals: {
              'aws:SourceAccount': '444455556666',
            },
          },
        },
      }),
    });

    const result = new EventBridgeBusPolicyDetector().detect(
      graph,
      createAccountResults(['111122223333', '444455556666']),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sourceArn: 'arn:aws:iam::444455556666:root',
      completeness: 'partial',
      missingAccountId: '444455556666',
    });
    expect(result[0]?.metadata).toMatchObject({
      isWildcardPrincipal: true,
      conditionKeys: ['aws:SourceAccount'],
    });
  });
});

function addEventBus(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
  name: string,
  metadata: Record<string, unknown>,
): void {
  addTestNode(graph, {
    arn: `arn:aws:events:eu-west-1:${accountId}:event-bus/${name}`,
    accountId,
    name,
    type: 'MESSAGE_QUEUE',
    sourceType: 'EVENTBRIDGE_BUS',
    metadata: {
      eventBusName: name,
      ...metadata,
    },
  });
}

function addAccountRoot(
  graph: ReturnType<typeof createTestGraph>,
  accountId: string,
): void {
  addTestNode(graph, {
    arn: `arn:aws:iam::${accountId}:root`,
    accountId,
    name: `root-${accountId}`,
    sourceType: 'ACCOUNT_PRINCIPAL',
    metadata: {},
  });
}

function toPolicyDocument(policy: Record<string, unknown>): string {
  return JSON.stringify(policy);
}
