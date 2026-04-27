import { SFNClient } from '@aws-sdk/client-sfn';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgeType } from '../../../../types/infrastructure.js';
import { transformToScanResult } from '../../graph-bridge.js';
import { scanStepFunctionStateMachines } from '../stepfunctions-scanner.js';

const REGION = 'eu-west-3';
const ACCOUNT_ID = '123456789012';
const STATE_MACHINE_ARN = `arn:aws:states:${REGION}:${ACCOUNT_ID}:stateMachine:order-flow`;
const SECOND_STATE_MACHINE_ARN = `arn:aws:states:${REGION}:${ACCOUNT_ID}:stateMachine:invoice-flow`;
const ROLE_ARN = `arn:aws:iam::${ACCOUNT_ID}:role/sfn-role`;
const LAMBDA_ARN = `arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:ship-order`;
const SQS_ARN = `arn:aws:sqs:${REGION}:${ACCOUNT_ID}:orders`;
const SQS_URL = `https://sqs.${REGION}.amazonaws.com/${ACCOUNT_ID}/orders`;
const SNS_ARN = `arn:aws:sns:${REGION}:${ACCOUNT_ID}:orders`;
const ECS_CLUSTER_ARN = `arn:aws:ecs:${REGION}:${ACCOUNT_ID}:cluster/workers`;
const DDB_TABLE_ARN = `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/orders`;
const LOG_GROUP_ARN = `arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/vendedlogs/states/order-flow`;

interface MockStepFunctionsScenario {
  readonly stateMachinePages: readonly (readonly Record<string, unknown>[])[];
  readonly descriptionsByArn: ReadonlyMap<string, Record<string, unknown>>;
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

function createDefinition(states: Record<string, unknown>): string {
  return JSON.stringify({
    StartAt: Object.keys(states)[0] ?? 'Done',
    States: states,
  });
}

function createDefaultScenario(
  overrides: Partial<MockStepFunctionsScenario> = {},
): MockStepFunctionsScenario {
  return {
    stateMachinePages: [[
      {
        stateMachineArn: STATE_MACHINE_ARN,
        name: 'order-flow',
        type: 'STANDARD',
        creationDate: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]],
    descriptionsByArn: new Map([
      [
        STATE_MACHINE_ARN,
        {
          stateMachineArn: STATE_MACHINE_ARN,
          name: 'order-flow',
          status: 'ACTIVE',
          definition: createDefinition({
            InvokeLambda: {
              Type: 'Task',
              Resource: LAMBDA_ARN,
              TimeoutSeconds: 30,
              Retry: [{ ErrorEquals: ['States.ALL'], MaxAttempts: 3 }],
              Catch: [{ ErrorEquals: ['States.ALL'], Next: 'Done' }],
              Next: 'Done',
            },
            Done: { Type: 'Succeed' },
          }),
          roleArn: ROLE_ARN,
          type: 'STANDARD',
          loggingConfiguration: {
            level: 'ERROR',
            includeExecutionData: false,
            destinations: [
              {
                cloudWatchLogsLogGroup: {
                  logGroupArn: `${LOG_GROUP_ARN}:*`,
                },
              },
            ],
          },
          tracingConfiguration: { enabled: true },
        },
      ],
    ]),
    ...overrides,
  };
}

function defaultDescription(): Record<string, unknown> {
  return readRecord(createDefaultScenario().descriptionsByArn.get(STATE_MACHINE_ARN));
}

function installStepFunctionsMock(scenario: MockStepFunctionsScenario) {
  const implementation = ((command: unknown) => {
    const name = commandName(command);
    const input = commandInput(command);

    if (name === 'ListStateMachinesCommand') {
      const page = pageAt(scenario.stateMachinePages, input.nextToken);
      return Promise.resolve({ stateMachines: page.items, nextToken: page.nextToken });
    }

    if (name === 'DescribeStateMachineCommand') {
      const stateMachineArn = readString(input.stateMachineArn) ?? '';
      return Promise.resolve(scenario.descriptionsByArn.get(stateMachineArn) ?? {});
    }

    if (name === 'ListTagsForResourceCommand') {
      return Promise.resolve({ tags: [] });
    }

    return Promise.reject(new Error(`Unexpected Step Functions command ${name}`));
  }) as unknown as SFNClient['send'];

  return vi.spyOn(SFNClient.prototype, 'send').mockImplementation(implementation);
}

async function scanScenario(scenario: MockStepFunctionsScenario) {
  installStepFunctionsMock(scenario);
  return scanStepFunctionStateMachines({ region: REGION, maxAttempts: 1 });
}

function stateMachineMetadata(
  result: Awaited<ReturnType<typeof scanStepFunctionStateMachines>>,
): Record<string, unknown> {
  const resource = result.resources.find((entry) => entry.type === 'SFN_STATE_MACHINE');
  expect(resource).toBeDefined();
  return resource?.metadata ?? {};
}

function readRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => readRecord(entry));
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StepFunctions Scanner', () => {
  it('discovers state machines', async () => {
    const result = await scanScenario(createDefaultScenario());

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.arn).toBe(STATE_MACHINE_ARN);
    expect(result.resources[0]?.type).toBe('SFN_STATE_MACHINE');
  });

  it('parses ASL definition and extracts task states', async () => {
    const result = await scanScenario(createDefaultScenario());
    const parsedDefinition = readRecord(stateMachineMetadata(result).parsedDefinition);
    const tasks = readRecordArray(parsedDefinition.taskStates);

    expect(parsedDefinition.totalStates).toBe(2);
    expect(tasks[0]?.name).toBe('InvokeLambda');
    expect(tasks[0]?.timeoutSeconds).toBe(30);
  });

  it('extracts Lambda ARN from optimized integration', async () => {
    const result = await scanScenario(createDefaultScenario());

    expect(stateMachineMetadata(result).definitionResourceArns).toEqual([LAMBDA_ARN]);
  });

  it('extracts Lambda ARN from SDK integration Parameters', async () => {
    const result = await scanScenario(
      createDefaultScenario({
        descriptionsByArn: new Map([
          [
            STATE_MACHINE_ARN,
            {
              ...defaultDescription(),
              definition: createDefinition({
                InvokeLambda: {
                  Type: 'Task',
                  Resource: 'arn:aws:states:::lambda:invoke',
                  Parameters: { FunctionName: LAMBDA_ARN },
                  End: true,
                },
              }),
            },
          ],
        ]),
      }),
    );

    expect(stateMachineMetadata(result).definitionResourceArns).toEqual([LAMBDA_ARN]);
  });

  it('creates edges SFN -> Lambda/SQS/SNS/ECS/DynamoDB', async () => {
    const result = await scanScenario(
      createDefaultScenario({
        descriptionsByArn: new Map([
          [
            STATE_MACHINE_ARN,
            {
              ...defaultDescription(),
              definition: createDefinition({
                InvokeLambda: { Type: 'Task', Resource: LAMBDA_ARN, End: true },
                SendSqs: {
                  Type: 'Task',
                  Resource: 'arn:aws:states:::sqs:sendMessage',
                  Parameters: { QueueUrl: SQS_URL },
                  End: true,
                },
                PublishSns: {
                  Type: 'Task',
                  Resource: 'arn:aws:states:::sns:publish',
                  Parameters: { TopicArn: SNS_ARN },
                  End: true,
                },
                RunEcs: {
                  Type: 'Task',
                  Resource: 'arn:aws:states:::ecs:runTask',
                  Parameters: { Cluster: ECS_CLUSTER_ARN },
                  End: true,
                },
                PutDdb: {
                  Type: 'Task',
                  Resource: 'arn:aws:states:::dynamodb:putItem',
                  Parameters: { TableName: 'orders' },
                  End: true,
                },
              }),
            },
          ],
        ]),
      }),
    );
    const graph = transformToScanResult([...result.resources], [], 'aws');

    expect(hasEdge(graph, STATE_MACHINE_ARN, LAMBDA_ARN, EdgeType.TRIGGERS)).toBe(true);
    expect(hasEdge(graph, STATE_MACHINE_ARN, SQS_ARN, EdgeType.PUBLISHES_TO)).toBe(true);
    expect(hasEdge(graph, STATE_MACHINE_ARN, SNS_ARN, EdgeType.PUBLISHES_TO)).toBe(true);
    expect(hasEdge(graph, STATE_MACHINE_ARN, ECS_CLUSTER_ARN, EdgeType.TRIGGERS)).toBe(true);
    expect(hasEdge(graph, STATE_MACHINE_ARN, DDB_TABLE_ARN, EdgeType.USES)).toBe(true);
  });

  it('creates edge SFN -> IAM role', async () => {
    const result = await scanScenario(createDefaultScenario());
    const graph = transformToScanResult([...result.resources], [], 'aws');

    expect(hasEdge(graph, STATE_MACHINE_ARN, ROLE_ARN, EdgeType.IAM_ACCESS)).toBe(true);
  });

  it('creates edge SFN -> CloudWatch log group', async () => {
    const result = await scanScenario(createDefaultScenario());
    const graph = transformToScanResult([...result.resources], [], 'aws');

    expect(hasEdge(graph, STATE_MACHINE_ARN, LOG_GROUP_ARN, EdgeType.USES)).toBe(true);
  });

  it('handles malformed ASL definition without crash', async () => {
    const result = await scanScenario(
      createDefaultScenario({
        descriptionsByArn: new Map([
          [
            STATE_MACHINE_ARN,
            {
              ...defaultDescription(),
              definition: '{broken',
            },
          ],
        ]),
      }),
    );
    const parsedDefinition = readRecord(stateMachineMetadata(result).parsedDefinition);

    expect(parsedDefinition.totalStates).toBe(0);
    expect(result.warnings.some((warning) => warning.includes('malformed'))).toBe(true);
  });

  it('handles empty state machine list', async () => {
    const result = await scanScenario(
      createDefaultScenario({
        stateMachinePages: [[]],
        descriptionsByArn: new Map(),
      }),
    );

    expect(result.resources).toEqual([]);
  });

  it('handles pagination on ListStateMachines', async () => {
    const result = await scanScenario(
      createDefaultScenario({
        stateMachinePages: [
          [{ stateMachineArn: STATE_MACHINE_ARN, name: 'order-flow', type: 'STANDARD' }],
          [{ stateMachineArn: SECOND_STATE_MACHINE_ARN, name: 'invoice-flow', type: 'STANDARD' }],
        ],
        descriptionsByArn: new Map([
          ...createDefaultScenario().descriptionsByArn,
          [
            SECOND_STATE_MACHINE_ARN,
            {
              stateMachineArn: SECOND_STATE_MACHINE_ARN,
              name: 'invoice-flow',
              status: 'ACTIVE',
              definition: createDefinition({
                Done: { Type: 'Succeed' },
              }),
              roleArn: ROLE_ARN,
              type: 'STANDARD',
            },
          ],
        ]),
      }),
    );

    expect(result.resources).toHaveLength(2);
  });
});
