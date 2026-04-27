import { describe, expect, it } from 'vitest';
import type { InfraNodeAttrs } from '../../../types/infrastructure.js';
import { runValidation } from '../../validation-engine.js';
import type { ValidationEdge, WeightedValidationResult } from '../../validation-types.js';
import { eventBridgeValidationRules } from '../eventbridge-rules.js';

const RULE_ARN = 'arn:aws:events:eu-west-3:123456789012:rule/orders-rule';
const TARGET_ARN = 'arn:aws:events:eu-west-3:123456789012:target/orders-rule/lambda';
const LAMBDA_ARN = 'arn:aws:lambda:eu-west-3:123456789012:function:ship-order';
const DLQ_ARN = 'arn:aws:sqs:eu-west-3:123456789012:eventbridge-dlq';

function createNode(
  overrides: Partial<InfraNodeAttrs> & {
    readonly id: string;
    readonly metadata: Record<string, unknown>;
  },
): InfraNodeAttrs {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    type: overrides.type ?? 'MESSAGE_QUEUE',
    provider: 'aws',
    region: 'eu-west-3',
    availabilityZone: null,
    tags: {},
    metadata: overrides.metadata,
    ...overrides,
  };
}

function createRuleNode(metadata: Record<string, unknown> = {}): InfraNodeAttrs {
  return createNode({
    id: RULE_ARN,
    name: 'orders-rule',
    metadata: {
      sourceType: 'EVENTBRIDGE_RULE',
      ruleArn: RULE_ARN,
      ruleName: 'orders-rule',
      eventBusName: 'default',
      state: 'ENABLED',
      ...metadata,
    },
  });
}

function createTargetNode(metadata: Record<string, unknown> = {}): InfraNodeAttrs {
  return createNode({
    id: TARGET_ARN,
    name: 'orders-rule:lambda',
    metadata: {
      sourceType: 'EVENTBRIDGE_TARGET',
      targetId: 'lambda',
      id: 'lambda',
      ruleArn: RULE_ARN,
      ruleName: 'orders-rule',
      targetArn: LAMBDA_ARN,
      deadLetterConfig: { arn: DLQ_ARN },
      retryPolicy: {
        maximumRetryAttempts: 3,
        maximumEventAgeInSeconds: 3600,
      },
      ...metadata,
    },
  });
}

function executeRule(
  ruleId: string,
  nodeId: string,
  nodes: readonly InfraNodeAttrs[],
  edges: readonly ValidationEdge[] = [],
): WeightedValidationResult {
  const report = runValidation(nodes, edges, eventBridgeValidationRules);
  const result = report.results.find(
    (entry) => entry.ruleId === ruleId && entry.nodeId === nodeId,
  );
  if (!result) throw new Error(`Missing result for ${ruleId}`);
  return result;
}

describe('EventBridge DR Rules', () => {
  it('flags disabled rule', () => {
    const result = executeRule('EVENTBRIDGE_RULE_DISABLED', RULE_ARN, [
      createRuleNode({ state: 'DISABLED' }),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('medium');
  });

  it('flags target without DLQ', () => {
    const result = executeRule('EVENTBRIDGE_TARGET_NO_DLQ', TARGET_ARN, [
      createTargetNode({ deadLetterConfig: null }),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('high');
  });

  it('passes target with DLQ', () => {
    const result = executeRule('EVENTBRIDGE_TARGET_NO_DLQ', TARGET_ARN, [createTargetNode()]);

    expect(result.status).toBe('pass');
  });

  it('flags target without retry policy', () => {
    const result = executeRule('EVENTBRIDGE_TARGET_NO_RETRY', TARGET_ARN, [
      createTargetNode({ retryPolicy: null }),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('medium');
  });
});
