import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgeType } from '../../../../types/infrastructure.js';
import { transformToScanResult } from '../../graph-bridge.js';
import { scanEventBridgeRules } from '../eventbridge-scanner.js';

const REGION = 'eu-west-3';
const ACCOUNT_ID = '123456789012';
const DEFAULT_BUS_ARN = `arn:aws:events:${REGION}:${ACCOUNT_ID}:event-bus/default`;
const CUSTOM_BUS_ARN = `arn:aws:events:${REGION}:${ACCOUNT_ID}:event-bus/custom-bus`;
const RULE_ARN = `arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/orders-rule`;
const CUSTOM_RULE_ARN = `arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/custom-bus/custom-rule`;
const LAMBDA_ARN = `arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:ship-order`;
const SQS_ARN = `arn:aws:sqs:${REGION}:${ACCOUNT_ID}:orders`;
const SNS_ARN = `arn:aws:sns:${REGION}:${ACCOUNT_ID}:orders`;
const ECS_CLUSTER_ARN = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:cluster/workers`;
const TASK_DEFINITION_ARN = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:task-definition/order-worker:7`;
const SFN_ARN = `arn:aws:states:${REGION}:${ACCOUNT_ID}:stateMachine:order-flow`;
const DLQ_ARN = `arn:aws:sqs:${REGION}:${ACCOUNT_ID}:eventbridge-dlq`;

interface MockEventBridgeScenario {
  readonly busPages: readonly (readonly Record<string, unknown>[])[];
  readonly rulesByBus: ReadonlyMap<string, readonly (readonly Record<string, unknown>[] )[]>;
  readonly describeRulesByKey: ReadonlyMap<string, Record<string, unknown>>;
  readonly targetsByRuleKey: ReadonlyMap<string, readonly (readonly Record<string, unknown>[] )[]>;
  readonly throttleTargetsAttempts?: number;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function commandName(command: unknown): string {
  if (!command || typeof command !== 'object') return '';
  return (command as { readonly constructor?: { readonly name?: string } }).constructor?.name ?? '';
}

function commandInput(command: unknown): Record<string, unknown> {
  if (!command || typeof command !== 'object') return {};
  return readRecord((command as { readonly input?: unknown }).input);
}

function pageAt<TValue>(
  pages: readonly (readonly TValue[])[] | undefined,
  nextToken: unknown,
): { readonly items: readonly TValue[]; readonly nextToken?: string } {
  const index = readString(nextToken) ? Number(nextToken) : 0;
  const page = pages?.[Number.isFinite(index) ? index : 0] ?? [];
  const followingIndex = (Number.isFinite(index) ? index : 0) + 1;
  return {
    items: page,
    ...(pages && followingIndex < pages.length ? { nextToken: String(followingIndex) } : {}),
  };
}

function ruleKey(busName: string, ruleName: string): string {
  return `${busName}|${ruleName}`;
}

function createThrottleError(): Error {
  const error = new Error('Rate exceeded');
  error.name = 'ThrottlingException';
  return error;
}

function createDefaultScenario(
  overrides: Partial<MockEventBridgeScenario> = {},
): MockEventBridgeScenario {
  return {
    busPages: [[
      { Name: 'default', Arn: DEFAULT_BUS_ARN },
      { Name: 'custom-bus', Arn: CUSTOM_BUS_ARN },
    ]],
    rulesByBus: new Map([
      ['default', [[{ Name: 'orders-rule', Arn: RULE_ARN }]]],
      ['custom-bus', [[{ Name: 'custom-rule', Arn: CUSTOM_RULE_ARN }]]],
    ]),
    describeRulesByKey: new Map([
      [
        ruleKey('default', 'orders-rule'),
        {
          Name: 'orders-rule',
          Arn: RULE_ARN,
          State: 'ENABLED',
          EventBusName: 'default',
          EventPattern: '{"source":["orders"]}',
        },
      ],
      [
        ruleKey('custom-bus', 'custom-rule'),
        {
          Name: 'custom-rule',
          Arn: CUSTOM_RULE_ARN,
          State: 'ENABLED',
          EventBusName: 'custom-bus',
          ScheduleExpression: 'rate(5 minutes)',
        },
      ],
    ]),
    targetsByRuleKey: new Map([
      [
        ruleKey('default', 'orders-rule'),
        [[
          {
            Id: 'lambda',
            Arn: LAMBDA_ARN,
            RetryPolicy: {
              MaximumRetryAttempts: 3,
              MaximumEventAgeInSeconds: 3600,
            },
            DeadLetterConfig: { Arn: DLQ_ARN },
          },
        ]],
      ],
      [ruleKey('custom-bus', 'custom-rule'), [[]]],
    ]),
    ...overrides,
  };
}

function installEventBridgeMock(scenario: MockEventBridgeScenario) {
  let targetAttempts = 0;
  const implementation = ((command: unknown) => {
    const name = commandName(command);
    const input = commandInput(command);

    if (name === 'ListEventBusesCommand') {
      const page = pageAt(scenario.busPages, input.NextToken);
      return Promise.resolve({ EventBuses: page.items, NextToken: page.nextToken });
    }

    if (name === 'ListRulesCommand') {
      const busName = readString(input.EventBusName) ?? 'default';
      const page = pageAt(scenario.rulesByBus.get(busName), input.NextToken);
      return Promise.resolve({ Rules: page.items, NextToken: page.nextToken });
    }

    if (name === 'DescribeRuleCommand') {
      const busName = readString(input.EventBusName) ?? 'default';
      const ruleName = readString(input.Name) ?? '';
      return Promise.resolve(scenario.describeRulesByKey.get(ruleKey(busName, ruleName)) ?? {});
    }

    if (name === 'ListTargetsByRuleCommand') {
      targetAttempts += 1;
      if (
        scenario.throttleTargetsAttempts &&
        targetAttempts <= scenario.throttleTargetsAttempts
      ) {
        throw createThrottleError();
      }
      const busName = readString(input.EventBusName) ?? 'default';
      const ruleName = readString(input.Rule) ?? '';
      const page = pageAt(scenario.targetsByRuleKey.get(ruleKey(busName, ruleName)), input.NextToken);
      return Promise.resolve({ Targets: page.items, NextToken: page.nextToken });
    }

    if (name === 'ListTagsForResourceCommand') {
      return Promise.resolve({ Tags: [] });
    }

    return Promise.reject(new Error(`Unexpected EventBridge command ${name}`));
  }) as unknown as EventBridgeClient['send'];

  return vi.spyOn(EventBridgeClient.prototype, 'send').mockImplementation(implementation);
}

async function scanScenario(scenario: MockEventBridgeScenario) {
  installEventBridgeMock(scenario);
  return scanEventBridgeRules({ region: REGION, maxAttempts: 1 });
}

function resourcesOf(resources: readonly { readonly type: string }[], type: string) {
  return resources.filter((resource) => resource.type === type);
}

function hasEdge(
  result: ReturnType<typeof transformToScanResult>,
  source: string,
  target: string,
  type: string,
): boolean {
  return result.edges.some(
    (edge) => edge.source === source && edge.target === target && edge.type === type,
  );
}

function targetResourceArn(targetId: string): string {
  return `arn:aws:events:${REGION}:${ACCOUNT_ID}:target/orders-rule/${targetId}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EventBridge Scanner', () => {
  it('discovers default and custom event buses', async () => {
    const result = await scanScenario(createDefaultScenario());

    expect(resourcesOf(result.resources, 'EVENTBRIDGE_BUS')).toHaveLength(2);
    expect(result.resources.map((resource) => resource.arn)).toContain(DEFAULT_BUS_ARN);
    expect(result.resources.map((resource) => resource.arn)).toContain(CUSTOM_BUS_ARN);
  });

  it('discovers rules on each bus', async () => {
    const result = await scanScenario(createDefaultScenario());

    expect(resourcesOf(result.resources, 'EVENTBRIDGE_RULE')).toHaveLength(2);
    expect(
      result.resources.find((resource) => resource.arn === CUSTOM_RULE_ARN)?.metadata
        ?.eventBusName,
    ).toBe('custom-bus');
  });

  it('discovers targets for each rule', async () => {
    const result = await scanScenario(createDefaultScenario());
    const target = resourcesOf(result.resources, 'EVENTBRIDGE_TARGET')[0];

    expect(target?.metadata?.targetArn).toBe(LAMBDA_ARN);
    expect(target?.metadata?.deadLetterConfig).toEqual({ arn: DLQ_ARN });
    expect(target?.metadata?.retryPolicy).toEqual({
      maximumRetryAttempts: 3,
      maximumEventAgeInSeconds: 3600,
    });
  });

  it('handles bus with zero rules', async () => {
    const result = await scanScenario(
      createDefaultScenario({
        rulesByBus: new Map([
          ['default', [[]]],
          ['custom-bus', [[]]],
        ]),
        targetsByRuleKey: new Map(),
      }),
    );

    expect(resourcesOf(result.resources, 'EVENTBRIDGE_BUS')).toHaveLength(2);
    expect(resourcesOf(result.resources, 'EVENTBRIDGE_RULE')).toHaveLength(0);
  });

  it('creates edges rule -> bus, target -> Lambda/SQS/SNS/ECS/SFN', async () => {
    const result = await scanScenario(
      createDefaultScenario({
        rulesByBus: new Map([
          ['default', [[{ Name: 'orders-rule', Arn: RULE_ARN }]]],
          ['custom-bus', [[]]],
        ]),
        targetsByRuleKey: new Map([
          [
            ruleKey('default', 'orders-rule'),
            [[
              { Id: 'lambda', Arn: LAMBDA_ARN },
              { Id: 'sqs', Arn: SQS_ARN },
              { Id: 'sns', Arn: SNS_ARN },
              {
                Id: 'ecs',
                Arn: ECS_CLUSTER_ARN,
                EcsParameters: { TaskDefinitionArn: TASK_DEFINITION_ARN },
              },
              { Id: 'sfn', Arn: SFN_ARN },
            ]],
          ],
        ]),
      }),
    );
    const graph = transformToScanResult([...result.resources], [], 'aws');

    expect(hasEdge(graph, RULE_ARN, DEFAULT_BUS_ARN, EdgeType.DEPENDS_ON)).toBe(true);
    expect(hasEdge(graph, targetResourceArn('lambda'), LAMBDA_ARN, EdgeType.TRIGGERS)).toBe(true);
    expect(hasEdge(graph, targetResourceArn('sqs'), SQS_ARN, EdgeType.PUBLISHES_TO)).toBe(true);
    expect(hasEdge(graph, targetResourceArn('sns'), SNS_ARN, EdgeType.PUBLISHES_TO)).toBe(true);
    expect(hasEdge(graph, targetResourceArn('ecs'), ECS_CLUSTER_ARN, EdgeType.TRIGGERS)).toBe(true);
    expect(hasEdge(graph, targetResourceArn('sfn'), SFN_ARN, EdgeType.TRIGGERS)).toBe(true);
  });

  it('creates edge target -> DLQ when configured', async () => {
    const result = await scanScenario(createDefaultScenario());
    const graph = transformToScanResult([...result.resources], [], 'aws');

    expect(hasEdge(graph, targetResourceArn('lambda'), DLQ_ARN, EdgeType.DEAD_LETTER)).toBe(true);
  });

  it('handles pagination on ListRules', async () => {
    const secondRuleArn = `arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/invoice-rule`;
    const result = await scanScenario(
      createDefaultScenario({
        rulesByBus: new Map([
          ['default', [[{ Name: 'orders-rule', Arn: RULE_ARN }], [{ Name: 'invoice-rule', Arn: secondRuleArn }]]],
          ['custom-bus', [[]]],
        ]),
        describeRulesByKey: new Map([
          ...createDefaultScenario().describeRulesByKey,
          [
            ruleKey('default', 'invoice-rule'),
            { Name: 'invoice-rule', Arn: secondRuleArn, State: 'ENABLED', EventBusName: 'default' },
          ],
        ]),
        targetsByRuleKey: new Map([
          [ruleKey('default', 'orders-rule'), [[]]],
          [ruleKey('default', 'invoice-rule'), [[]]],
          [ruleKey('custom-bus', 'custom-rule'), [[]]],
        ]),
      }),
    );

    expect(resourcesOf(result.resources, 'EVENTBRIDGE_RULE')).toHaveLength(2);
  });

  it('handles throttling with retry', async () => {
    const result = await scanScenario(createDefaultScenario({ throttleTargetsAttempts: 2 }));

    expect(resourcesOf(result.resources, 'EVENTBRIDGE_TARGET')).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });
});
