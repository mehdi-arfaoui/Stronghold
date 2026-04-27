import { LambdaClient } from '@aws-sdk/client-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgeType } from '../../../../types/infrastructure.js';
import { transformToScanResult } from '../../graph-bridge.js';
import { scanLambdaFunctions } from '../lambda-scanner.js';

const REGION = 'eu-west-3';
const ACCOUNT_ID = '123456789012';
const FUNCTION_ARN = `arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:worker`;
const FUNCTION_ALIAS_ARN = `${FUNCTION_ARN}:live`;
const SQS_ARN = `arn:aws:sqs:${REGION}:${ACCOUNT_ID}:jobs`;
const DLQ_ARN = `arn:aws:sqs:${REGION}:${ACCOUNT_ID}:worker-dlq`;
const SNS_ARN = `arn:aws:sns:${REGION}:${ACCOUNT_ID}:worker-topic`;
const DDB_STREAM_ARN =
  `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/orders/stream/2026-04-01T00:00:00.000`;
const KINESIS_STREAM_ARN = `arn:aws:kinesis:${REGION}:${ACCOUNT_ID}:stream/orders`;
const LAYER_ARN = `arn:aws:lambda:${REGION}:${ACCOUNT_ID}:layer:shared-lib:3`;

interface MockLambdaScenario {
  readonly functionSummary: Record<string, unknown>;
  readonly functionConfiguration: Record<string, unknown>;
  readonly eventSourceMappings: readonly Record<string, unknown>[];
  readonly asyncInvokeConfig?: Record<string, unknown> | null;
  readonly reservedConcurrency?: number | null;
  readonly provisionedConcurrencyConfigs: readonly Record<string, unknown>[];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function commandName(command: unknown): string {
  if (!command || typeof command !== 'object') return '';
  return (command as { readonly constructor?: { readonly name?: string } }).constructor?.name ?? '';
}

function commandInput(command: unknown): Record<string, unknown> {
  if (!command || typeof command !== 'object') return {};
  return readRecord((command as { readonly input?: unknown }).input);
}

function createResourceNotFoundError(): Error {
  const error = new Error('No async invoke config');
  error.name = 'ResourceNotFoundException';
  return error;
}

function createDefaultScenario(overrides: Partial<MockLambdaScenario> = {}): MockLambdaScenario {
  return {
    functionSummary: {
      FunctionName: 'worker',
      FunctionArn: FUNCTION_ARN,
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
      Timeout: 30,
      MemorySize: 256,
    },
    functionConfiguration: {
      FunctionName: 'worker',
      FunctionArn: FUNCTION_ARN,
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
      Timeout: 30,
      MemorySize: 256,
      Role: `arn:aws:iam::${ACCOUNT_ID}:role/worker-role`,
      Environment: { Variables: {} },
      VpcConfig: {
        VpcId: 'vpc-123',
        SubnetIds: ['subnet-a', 'subnet-b'],
        SecurityGroupIds: ['sg-worker'],
      },
    },
    eventSourceMappings: [],
    reservedConcurrency: null,
    provisionedConcurrencyConfigs: [],
    ...overrides,
  };
}

function installLambdaMock(scenario: MockLambdaScenario) {
  const implementation = ((command: unknown) => {
    const name = commandName(command);
    const input = commandInput(command);

    if (name === 'ListFunctionsCommand') {
      return Promise.resolve({ Functions: [scenario.functionSummary] });
    }

    if (name === 'ListTagsCommand') {
      return Promise.resolve({ Tags: { Name: 'worker' } });
    }

    if (name === 'GetFunctionConfigurationCommand') {
      return Promise.resolve(scenario.functionConfiguration);
    }

    if (name === 'GetFunctionEventInvokeConfigCommand') {
      if (Object.prototype.hasOwnProperty.call(scenario, 'asyncInvokeConfig')) {
        return Promise.resolve(scenario.asyncInvokeConfig ?? {});
      }
      throw createResourceNotFoundError();
    }

    if (name === 'ListEventSourceMappingsCommand') {
      expect(input.FunctionName).toBe('worker');
      return Promise.resolve({ EventSourceMappings: scenario.eventSourceMappings });
    }

    if (name === 'GetFunctionConcurrencyCommand') {
      return Promise.resolve({
        ...(scenario.reservedConcurrency === null || scenario.reservedConcurrency === undefined
          ? {}
          : { ReservedConcurrentExecutions: scenario.reservedConcurrency }),
      });
    }

    if (name === 'ListProvisionedConcurrencyConfigsCommand') {
      return Promise.resolve({
        ProvisionedConcurrencyConfigs: scenario.provisionedConcurrencyConfigs,
      });
    }

    return Promise.reject(new Error(`Unexpected Lambda command ${name}`));
  }) as unknown as LambdaClient['send'];

  return vi.spyOn(LambdaClient.prototype, 'send').mockImplementation(implementation);
}

async function scanScenario(scenario: MockLambdaScenario) {
  installLambdaMock(scenario);
  return scanLambdaFunctions({ region: REGION, maxAttempts: 1 });
}

function lambdaMetadata(
  result: Awaited<ReturnType<typeof scanLambdaFunctions>>,
): Record<string, unknown> {
  const resource = result.resources.find((entry) => entry.type === 'LAMBDA');
  expect(resource).toBeDefined();
  return resource?.metadata ?? {};
}

function readRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readRecord(entry))
    .filter((entry) => Object.keys(entry).length > 0);
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

describe('Lambda Scanner (enriched)', () => {
  describe('event source mappings', () => {
    it('discovers SQS event source mapping', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          eventSourceMappings: [
            {
              UUID: 'esm-sqs',
              EventSourceArn: SQS_ARN,
              State: 'Enabled',
              BatchSize: 10,
              MaximumRetryAttempts: 3,
              FunctionResponseTypes: ['ReportBatchItemFailures'],
            },
          ],
        }),
      );

      const mappings = readRecordArray(lambdaMetadata(result).eventSourceMappings);
      expect(mappings[0]?.eventSourceArn).toBe(SQS_ARN);
      expect(mappings[0]?.functionResponseTypes).toEqual(['ReportBatchItemFailures']);
    });

    it('discovers DynamoDB stream event source', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          eventSourceMappings: [
            {
              UUID: 'esm-ddb',
              EventSourceArn: DDB_STREAM_ARN,
              State: 'Enabled',
              BatchSize: 100,
              BisectBatchOnFunctionError: true,
            },
          ],
        }),
      );

      const mappings = readRecordArray(lambdaMetadata(result).eventSourceMappings);
      expect(mappings[0]?.eventSourceArn).toBe(DDB_STREAM_ARN);
      expect(mappings[0]?.bisectBatchOnFunctionError).toBe(true);
    });

    it('handles function with zero event sources', async () => {
      const result = await scanScenario(createDefaultScenario());

      expect(lambdaMetadata(result).eventSourceMappings).toEqual([]);
    });

    it('creates edge Lambda <- SQS for event source', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          eventSourceMappings: [
            {
              UUID: 'esm-sqs',
              EventSourceArn: SQS_ARN,
              State: 'Enabled',
              BatchSize: 10,
            },
          ],
        }),
      );
      const graph = transformToScanResult([...result.resources], [], 'aws');

      expect(hasEdge(graph, SQS_ARN, FUNCTION_ARN, EdgeType.TRIGGERS)).toBe(true);
    });
  });

  describe('DLQ configuration', () => {
    it('discovers DLQ SQS target', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          functionConfiguration: {
            ...createDefaultScenario().functionConfiguration,
            DeadLetterConfig: { TargetArn: DLQ_ARN },
          },
        }),
      );

      expect(lambdaMetadata(result).deadLetterConfig).toEqual({ targetArn: DLQ_ARN });
    });

    it('handles no DLQ configured', async () => {
      const result = await scanScenario(createDefaultScenario());

      expect(lambdaMetadata(result).deadLetterConfig).toBeNull();
    });

    it('creates edge Lambda -> SQS for DLQ', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          functionConfiguration: {
            ...createDefaultScenario().functionConfiguration,
            DeadLetterConfig: { TargetArn: DLQ_ARN },
          },
        }),
      );
      const graph = transformToScanResult([...result.resources], [], 'aws');

      expect(hasEdge(graph, FUNCTION_ARN, DLQ_ARN, EdgeType.DEAD_LETTER)).toBe(true);
    });
  });

  describe('async invocation config', () => {
    it('discovers async destinations', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          asyncInvokeConfig: {
            MaximumRetryAttempts: 1,
            MaximumEventAgeInSeconds: 3_600,
            DestinationConfig: {
              OnFailure: { Destination: DLQ_ARN },
              OnSuccess: { Destination: SNS_ARN },
            },
          },
        }),
      );

      const asyncInvokeConfig = readRecord(lambdaMetadata(result).asyncInvokeConfig);
      const destinationConfig = readRecord(asyncInvokeConfig.destinationConfig);
      expect(readRecord(destinationConfig.onFailure).destination).toBe(DLQ_ARN);
      expect(readRecord(destinationConfig.onSuccess).destination).toBe(SNS_ARN);
    });

    it('handles ResourceNotFoundException (no async config)', async () => {
      const result = await scanScenario(createDefaultScenario());

      expect(lambdaMetadata(result).asyncInvokeConfig).toBeNull();
      expect(result.warnings).toEqual([]);
    });

    it('creates edge Lambda -> SQS for onFailure destination', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          asyncInvokeConfig: {
            DestinationConfig: {
              OnFailure: { Destination: DLQ_ARN },
            },
          },
        }),
      );
      const graph = transformToScanResult([...result.resources], [], 'aws');

      expect(hasEdge(graph, FUNCTION_ARN, DLQ_ARN, EdgeType.DEAD_LETTER)).toBe(true);
    });
  });

  describe('concurrency', () => {
    it('discovers reserved concurrency', async () => {
      const result = await scanScenario(createDefaultScenario({ reservedConcurrency: 100 }));

      expect(lambdaMetadata(result).reservedConcurrency).toBe(100);
    });

    it('handles unreserved function', async () => {
      const result = await scanScenario(createDefaultScenario({ reservedConcurrency: null }));

      expect(lambdaMetadata(result).reservedConcurrency).toBeNull();
    });

    it('discovers provisioned concurrency on alias', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          provisionedConcurrencyConfigs: [
            {
              FunctionArn: FUNCTION_ALIAS_ARN,
              AllocatedProvisionedConcurrentExecutions: 25,
              AvailableProvisionedConcurrentExecutions: 24,
              Status: 'READY',
            },
          ],
        }),
      );

      expect(lambdaMetadata(result).provisionedConcurrency).toEqual({
        allocatedConcurrency: 25,
        availableConcurrency: 24,
        status: 'READY',
        aliasOrVersion: 'live',
      });
    });
  });

  describe('layers', () => {
    it('exposes layer ARNs from function configuration', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          functionConfiguration: {
            ...createDefaultScenario().functionConfiguration,
            Layers: [{ Arn: LAYER_ARN, CodeSize: 4096 }],
          },
        }),
      );

      expect(lambdaMetadata(result).layers).toEqual([{ arn: LAYER_ARN, codeSize: 4096 }]);
    });
  });

  describe('event source destinations', () => {
    it('creates edge Lambda -> SQS for event source onFailure destination', async () => {
      const result = await scanScenario(
        createDefaultScenario({
          eventSourceMappings: [
            {
              UUID: 'esm-kinesis',
              EventSourceArn: KINESIS_STREAM_ARN,
              State: 'Enabled',
              DestinationConfig: {
                OnFailure: { Destination: DLQ_ARN },
              },
            },
          ],
        }),
      );
      const graph = transformToScanResult([...result.resources], [], 'aws');

      expect(hasEdge(graph, FUNCTION_ARN, DLQ_ARN, EdgeType.DEAD_LETTER)).toBe(true);
    });
  });
});
