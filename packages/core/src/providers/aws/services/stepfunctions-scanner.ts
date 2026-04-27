/**
 * Scans AWS Step Functions state machines and parses ASL definitions.
 */

import {
  DescribeStateMachineCommand,
  ListStateMachinesCommand,
  ListTagsForResourceCommand,
  SFNClient,
  type DescribeStateMachineOutput,
  type LoggingConfiguration,
  type StateMachineListItem,
} from '@aws-sdk/client-sfn';
import { createAccountContext, tryParseArn, type AccountContext } from '../../../identity/index.js';
import type { DiscoveredResource } from '../../../types/discovery.js';
import {
  EdgeType,
  type StepFunctionsParsedDefinition,
  type StepFunctionsTaskState,
} from '../../../types/infrastructure.js';
import {
  computeRetryDelayMs,
  getAwsFailureType,
  isAwsThrottlingError,
  type AwsRetryPolicy,
} from '../aws-retry-utils.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { createResource, paginateAws, sleep } from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, tagsArrayToMap } from '../tag-utils.js';

const STEPFUNCTIONS_RETRY_POLICY: AwsRetryPolicy = {
  maxAttempts: 4,
  initialBackoffMs: 1,
  backoffMultiplier: 2,
  maxJitterMs: 0,
};

interface StepFunctionsDependencyEdgeSummary {
  readonly target: string;
  readonly type: string;
  readonly relationship: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ParsedDefinitionResult {
  readonly parsedDefinition: StepFunctionsParsedDefinition;
  readonly dependencyArns: readonly string[];
  readonly dependencyEdges: readonly StepFunctionsDependencyEdgeSummary[];
  readonly warnings: readonly string[];
}

export interface DefinitionParseContext {
  readonly partition: string;
  readonly region: string;
  readonly accountId: string;
}

const EMPTY_PARSED_DEFINITION: StepFunctionsParsedDefinition = {
  totalStates: 0,
  taskStates: [],
  waitStates: 0,
  parallelStates: 0,
  hasTimeout: false,
};

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readRecord(entry))
    .filter((entry) => Object.keys(entry).length > 0);
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => readString(entry)).filter((entry): entry is string => entry !== null);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

async function sendWithRetry<TValue>(action: () => Promise<TValue>): Promise<TValue> {
  let retryCount = 0;

  for (let attempt = 1; attempt <= STEPFUNCTIONS_RETRY_POLICY.maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (isAwsThrottlingError(error) && attempt < STEPFUNCTIONS_RETRY_POLICY.maxAttempts) {
        retryCount += 1;
        await sleep(computeRetryDelayMs(retryCount, STEPFUNCTIONS_RETRY_POLICY, () => 0));
        continue;
      }
      throw error;
    }
  }

  throw new Error('Step Functions retry loop exhausted unexpectedly.');
}

function accountContextFromArn(arn: string): AccountContext | null {
  const parsed = tryParseArn(arn);
  if (!parsed?.accountId) return null;
  return createAccountContext({
    accountId: parsed.accountId,
    partition: parsed.partition,
  });
}

function parseContextFromArn(arn: string, fallbackRegion: string): DefinitionParseContext | null {
  const parsed = tryParseArn(arn);
  if (!parsed?.accountId) return null;
  return {
    partition: parsed.partition,
    region: parsed.region ?? fallbackRegion,
    accountId: parsed.accountId,
  };
}

function buildLambdaArn(name: string, context: DefinitionParseContext): string | null {
  if (!name) return null;
  if (name.startsWith('arn:')) return name;
  if (name.includes('$') || name.includes('{') || name.includes('}')) return null;
  return `arn:${context.partition}:lambda:${context.region}:${context.accountId}:function:${name}`;
}

function buildEcsClusterArn(name: string, context: DefinitionParseContext): string | null {
  if (!name) return null;
  if (name.startsWith('arn:')) return name;
  if (name.includes('$') || name.includes('{') || name.includes('}')) return null;
  return `arn:${context.partition}:ecs:${context.region}:${context.accountId}:cluster/${name}`;
}

function buildDynamoDbTableArn(name: string, context: DefinitionParseContext): string | null {
  if (!name) return null;
  if (name.startsWith('arn:')) return name;
  if (name.includes('$') || name.includes('{') || name.includes('}')) return null;
  return `arn:${context.partition}:dynamodb:${context.region}:${context.accountId}:table/${name}`;
}

function queueArnFromUrl(queueUrl: string, context: DefinitionParseContext): string | null {
  if (queueUrl.startsWith('arn:')) return queueUrl;
  try {
    const parsed = new URL(queueUrl);
    const pathSegments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
    const accountId = pathSegments[0] ?? context.accountId;
    const queueName = pathSegments[1] ?? pathSegments[0];
    if (!accountId || !queueName || !/^\d{12}$/.test(accountId)) return null;
    const regionMatch = /\.sqs\.([a-z0-9-]+)\./.exec(parsed.hostname);
    const region = regionMatch?.[1] ?? context.region;
    return `arn:${context.partition}:sqs:${region}:${accountId}:${queueName}`;
  } catch {
    return null;
  }
}

function buildSqsQueueArn(name: string, context: DefinitionParseContext): string | null {
  if (!name) return null;
  if (name.startsWith('arn:')) return name;
  if (name.startsWith('http://') || name.startsWith('https://')) return queueArnFromUrl(name, context);
  if (name.includes('$') || name.includes('{') || name.includes('}')) return null;
  return `arn:${context.partition}:sqs:${context.region}:${context.accountId}:${name}`;
}

function normalizeCloudWatchLogGroupArn(arn: string): string {
  return arn.endsWith(':*') ? arn.slice(0, -2) : arn;
}

function parametersForState(state: Record<string, unknown>): Record<string, unknown> {
  const parameters = readRecord(state.Parameters);
  if (Object.keys(parameters).length > 0) return parameters;
  return readRecord(state.Arguments);
}

function readParameterString(
  parameters: Record<string, unknown>,
  key: string,
): string | null {
  return readString(parameters[key]) ?? readString(parameters[`${key}.$`]);
}

function taskServiceLabel(resource: string): string | null {
  if (resource.includes(':states:::lambda:invoke')) return 'Lambda';
  if (resource.includes(':states:::ecs:runTask')) return 'ECS';
  if (resource.includes(':states:::sqs:sendMessage')) return 'SQS';
  if (resource.includes(':states:::sns:publish')) return 'SNS';
  if (resource.includes(':states:::dynamodb:')) return 'DynamoDB';
  if (resource.includes(':states:::states:startExecution')) return 'Step Functions';
  const directService = tryParseArn(resource)?.service ?? null;
  if (directService === 'lambda') return 'Lambda';
  if (directService === 'states') return 'Step Functions';
  return null;
}

function edgeTypeForDependency(arn: string, relationship: string): string {
  const service = tryParseArn(arn)?.service;
  if (service === 'lambda' || service === 'ecs' || service === 'states') return EdgeType.TRIGGERS;
  if (service === 'sqs' || service === 'sns') return EdgeType.PUBLISHES_TO;
  if (relationship === 'writes_logs_to') return EdgeType.USES;
  return EdgeType.USES;
}

function dependencyRelationshipForArn(arn: string, integrationLabel: string | null): string {
  const service = tryParseArn(arn)?.service;
  if (service === 'lambda') return 'invokes_lambda_function';
  if (service === 'ecs') return 'runs_ecs_task';
  if (service === 'sqs') return 'sends_sqs_message';
  if (service === 'sns') return 'publishes_sns_message';
  if (service === 'dynamodb') return 'uses_dynamodb_table';
  if (service === 'states') return 'starts_step_function_execution';
  if (integrationLabel) return `uses_${integrationLabel.toLowerCase().replace(/\s+/g, '_')}`;
  return 'uses_definition_resource';
}

function collectTaskDependencyArns(
  resource: string,
  state: Record<string, unknown>,
  context: DefinitionParseContext,
): readonly string[] {
  const parameters = parametersForState(state);
  const directParsed = resource.startsWith('arn:') ? tryParseArn(resource) : null;
  const directArn = directParsed ? resource : null;
  const directService = directParsed?.service ?? null;

  if (directArn && directService === 'lambda') return [directArn];
  if (directArn && directService === 'states' && directParsed?.accountId) return [directArn];

  if (resource.includes(':states:::lambda:invoke')) {
    const functionName = readParameterString(parameters, 'FunctionName');
    const lambdaArn = functionName ? buildLambdaArn(functionName, context) : null;
    return lambdaArn ? [lambdaArn] : [];
  }

  if (resource.includes(':states:::ecs:runTask')) {
    const cluster = readParameterString(parameters, 'Cluster');
    const clusterArn = cluster ? buildEcsClusterArn(cluster, context) : null;
    return clusterArn ? [clusterArn] : [];
  }

  if (resource.includes(':states:::sqs:sendMessage')) {
    const queueArn =
      readParameterString(parameters, 'QueueArn') ??
      buildSqsQueueArn(readParameterString(parameters, 'QueueUrl') ?? '', context);
    return queueArn ? [queueArn] : [];
  }

  if (resource.includes(':states:::sns:publish')) {
    const topicArn = readParameterString(parameters, 'TopicArn');
    return topicArn ? [topicArn] : [];
  }

  if (resource.includes(':states:::dynamodb:')) {
    const tableArn =
      readParameterString(parameters, 'TableArn') ??
      buildDynamoDbTableArn(readParameterString(parameters, 'TableName') ?? '', context);
    return tableArn ? [tableArn] : [];
  }

  if (resource.includes(':states:::states:startExecution')) {
    const stateMachineArn = readParameterString(parameters, 'StateMachineArn');
    return stateMachineArn ? [stateMachineArn] : [];
  }

  return directArn ? [directArn] : [];
}

function summarizeRetry(value: unknown): StepFunctionsTaskState['retry'] {
  const retries = readRecordArray(value).map((entry) => ({
    errorEquals: readStringArray(entry.ErrorEquals),
    intervalSeconds: readNumber(entry.IntervalSeconds) ?? 1,
    maxAttempts: readNumber(entry.MaxAttempts) ?? 3,
    backoffRate: readNumber(entry.BackoffRate) ?? 2,
  }));
  return retries.length > 0 ? retries : null;
}

function summarizeCatch(value: unknown): StepFunctionsTaskState['catch'] {
  const catchers = readRecordArray(value)
    .map((entry) => {
      const next = readString(entry.Next);
      if (!next) return null;
      return {
        errorEquals: readStringArray(entry.ErrorEquals),
        next,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  return catchers.length > 0 ? catchers : null;
}

function visitStates(
  states: Record<string, unknown>,
  context: DefinitionParseContext,
  accumulator: {
    totalStates: number;
    taskStates: StepFunctionsTaskState[];
    waitStates: number;
    parallelStates: number;
    hasTaskTimeout: boolean;
    dependencyArns: string[];
    dependencyEdges: StepFunctionsDependencyEdgeSummary[];
  },
): void {
  for (const [stateName, rawState] of Object.entries(states)) {
    const state = readRecord(rawState);
    if (Object.keys(state).length === 0) continue;
    const type = readString(state.Type);
    accumulator.totalStates += 1;

    if (type === 'Task') {
      const resource = readString(state.Resource) ?? '';
      const timeoutSeconds = readNumber(state.TimeoutSeconds);
      const heartbeatSeconds = readNumber(state.HeartbeatSeconds);
      if (timeoutSeconds !== null) accumulator.hasTaskTimeout = true;
      const integrationLabel = taskServiceLabel(resource);
      const dependencies = collectTaskDependencyArns(resource, state, context);
      accumulator.dependencyArns.push(...dependencies);
      accumulator.dependencyEdges.push(
        ...dependencies.map((arn) => {
          const relationship = dependencyRelationshipForArn(arn, integrationLabel);
          return {
            target: arn,
            type: edgeTypeForDependency(arn, relationship),
            relationship,
            metadata: {
              stateName,
              resource,
              ...(integrationLabel ? { integration: integrationLabel } : {}),
            },
          };
        }),
      );
      accumulator.taskStates.push({
        name: stateName,
        resource,
        service: integrationLabel,
        timeoutSeconds,
        heartbeatSeconds,
        retry: summarizeRetry(state.Retry),
        catch: summarizeCatch(state.Catch),
        next: readString(state.Next),
        end: readBoolean(state.End) ?? false,
        isTerminal: readBoolean(state.End) === true || readString(state.Next) === null,
      });
    }

    if (type === 'Wait') accumulator.waitStates += 1;
    if (type === 'Parallel') accumulator.parallelStates += 1;

    for (const branch of readRecordArray(state.Branches)) {
      visitStates(readRecord(branch.States), context, accumulator);
    }

    const iteratorStates = readRecord(readRecord(state.Iterator).States);
    if (Object.keys(iteratorStates).length > 0) {
      visitStates(iteratorStates, context, accumulator);
    }

    const itemProcessorStates = readRecord(readRecord(state.ItemProcessor).States);
    if (Object.keys(itemProcessorStates).length > 0) {
      visitStates(itemProcessorStates, context, accumulator);
    }
  }
}

export function parseStepFunctionsDefinition(
  definition: string,
  context: DefinitionParseContext,
  stateMachineName: string,
): ParsedDefinitionResult {
  try {
    const document = readRecord(JSON.parse(definition) as unknown);
    const accumulator = {
      totalStates: 0,
      taskStates: [] as StepFunctionsTaskState[],
      waitStates: 0,
      parallelStates: 0,
      hasTaskTimeout: false,
      dependencyArns: [] as string[],
      dependencyEdges: [] as StepFunctionsDependencyEdgeSummary[],
    };

    visitStates(readRecord(document.States), context, accumulator);

    const parsedDefinition: StepFunctionsParsedDefinition = {
      totalStates: accumulator.totalStates,
      taskStates: accumulator.taskStates,
      waitStates: accumulator.waitStates,
      parallelStates: accumulator.parallelStates,
      hasTimeout: readNumber(document.TimeoutSeconds) !== null || accumulator.hasTaskTimeout,
    };
    const dependencyArns = uniqueStrings(accumulator.dependencyArns);
    const dependencyEdges = Array.from(
      new Map(
        accumulator.dependencyEdges.map((edge) => [
          `${edge.target}|${edge.type}|${edge.relationship}`,
          edge,
        ] as const),
      ).values(),
    );

    return {
      parsedDefinition,
      dependencyArns,
      dependencyEdges,
      warnings: [],
    };
  } catch {
    return {
      parsedDefinition: EMPTY_PARSED_DEFINITION,
      dependencyArns: [],
      dependencyEdges: [],
      warnings: [`Step Functions ASL definition malformed for ${stateMachineName}.`],
    };
  }
}

function summarizeLoggingConfiguration(
  loggingConfiguration: LoggingConfiguration | undefined,
): {
  readonly level: string;
  readonly includeExecutionData: boolean;
  readonly destinations: readonly {
    readonly cloudWatchLogsLogGroup: {
      readonly logGroupArn: string;
    };
  }[];
} | null {
  if (!loggingConfiguration) return null;
  return {
    level: loggingConfiguration.level ?? 'OFF',
    includeExecutionData: loggingConfiguration.includeExecutionData ?? false,
    destinations: (loggingConfiguration.destinations ?? [])
      .map((destination) => {
        const logGroupArn = readString(destination.cloudWatchLogsLogGroup?.logGroupArn);
        if (!logGroupArn) return null;
        return {
          cloudWatchLogsLogGroup: {
            logGroupArn,
          },
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  };
}

function summarizeTracingConfiguration(
  tracingConfiguration: DescribeStateMachineOutput['tracingConfiguration'],
): { readonly enabled: boolean } | null {
  if (!tracingConfiguration) return null;
  return { enabled: tracingConfiguration.enabled ?? false };
}

function logGroupArnsFromLoggingConfiguration(
  loggingConfiguration: ReturnType<typeof summarizeLoggingConfiguration>,
): readonly string[] {
  return uniqueStrings(
    (loggingConfiguration?.destinations ?? [])
      .map((destination) => destination.cloudWatchLogsLogGroup.logGroupArn)
      .map((arn) => normalizeCloudWatchLogGroupArn(arn)),
  );
}

function buildDirectDependencyEdges(input: {
  readonly roleArn: string | null;
  readonly definitionEdges: readonly StepFunctionsDependencyEdgeSummary[];
  readonly logGroupArns: readonly string[];
}): readonly StepFunctionsDependencyEdgeSummary[] {
  return [
    ...(input.roleArn
      ? [
          {
            target: input.roleArn,
            type: EdgeType.IAM_ACCESS,
            relationship: 'uses_execution_role',
          },
        ]
      : []),
    ...input.definitionEdges,
    ...input.logGroupArns.map((logGroupArn) => ({
      target: logGroupArn,
      type: EdgeType.USES,
      relationship: 'writes_logs_to',
    })),
  ];
}

async function describeStateMachine(
  sfn: SFNClient,
  options: AwsClientOptions,
  stateMachine: StateMachineListItem,
  warnings: string[],
): Promise<DescribeStateMachineOutput | null> {
  if (!stateMachine.stateMachineArn) return null;
  try {
    return await sendWithRetry(() =>
      sfn.send(
        new DescribeStateMachineCommand({ stateMachineArn: stateMachine.stateMachineArn }),
        getAwsCommandOptions(options),
      ),
    );
  } catch (error) {
    warnings.push(
      `Step Functions details unavailable for ${stateMachine.name ?? stateMachine.stateMachineArn} in ${options.region} (${getAwsFailureType(error)}).`,
    );
    return null;
  }
}

export async function scanStepFunctionStateMachines(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const sfn = createAwsClient(SFNClient, options);
  const warnings: string[] = [];
  const resources: DiscoveredResource[] = [];
  const tagWarnings = new Set<string>();

  const stateMachines = await paginateAws(
    (nextToken) =>
      sendWithRetry(() =>
        sfn.send(
          new ListStateMachinesCommand({ nextToken }),
          getAwsCommandOptions(options),
        ),
      ),
    (response) => response.stateMachines,
    (response) => response.nextToken,
  );

  for (const stateMachine of stateMachines) {
    const stateMachineArn = readString(stateMachine.stateMachineArn);
    const stateMachineName = readString(stateMachine.name);
    if (!stateMachineArn || !stateMachineName) continue;

    const accountContext = accountContextFromArn(stateMachineArn);
    const parseContext = parseContextFromArn(stateMachineArn, options.region);
    if (!accountContext || !parseContext) continue;

    const tags = await fetchAwsTagsWithRetry(
      () =>
        sfn.send(
          new ListTagsForResourceCommand({ resourceArn: stateMachineArn }),
          getAwsCommandOptions(options),
        ),
      (response) => tagsArrayToMap(response.tags),
      {
        description: `Step Functions tag discovery unavailable in ${options.region}`,
        warnings,
        warningDeduper: tagWarnings,
      },
    );
    const displayName = getNameTag(tags) ?? stateMachineName;
    const describeResponse = await describeStateMachine(sfn, options, stateMachine, warnings);
    const definition = describeResponse?.definition ?? '{}';
    const parsedDefinition = parseStepFunctionsDefinition(
      definition,
      parseContext,
      stateMachineName,
    );
    warnings.push(...parsedDefinition.warnings);
    const roleArn = readString(describeResponse?.roleArn);
    const loggingConfiguration = summarizeLoggingConfiguration(
      describeResponse?.loggingConfiguration,
    );
    const logGroupArns = logGroupArnsFromLoggingConfiguration(loggingConfiguration);
    const tracingConfiguration = summarizeTracingConfiguration(
      describeResponse?.tracingConfiguration,
    );

    resources.push(
      createResource({
        source: 'aws',
        arn: stateMachineArn,
        name: displayName,
        kind: 'service',
        type: 'SFN_STATE_MACHINE',
        account: accountContext,
        tags,
        metadata: {
          name: stateMachineName,
          stateMachineArn,
          stateMachineName,
          type: describeResponse?.type ?? stateMachine.type ?? '',
          stateMachineType: describeResponse?.type ?? stateMachine.type ?? '',
          status: describeResponse?.status ?? '',
          roleArn,
          definition,
          loggingConfiguration,
          tracingConfiguration,
          parsedDefinition: parsedDefinition.parsedDefinition,
          definitionResourceArns: parsedDefinition.dependencyArns,
          cloudWatchLogGroupArns: logGroupArns,
          directDependencyEdges: buildDirectDependencyEdges({
            roleArn,
            definitionEdges: parsedDefinition.dependencyEdges,
            logGroupArns,
          }),
          revisionId: describeResponse?.revisionId ?? null,
          createdAt: stateMachine.creationDate?.toISOString() ?? null,
          displayName,
          ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
        },
      }),
    );
  }

  return {
    resources,
    warnings: uniqueStrings(warnings),
  };
}
