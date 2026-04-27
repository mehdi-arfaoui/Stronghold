/**
 * Scans AWS Lambda functions with environment reference extraction.
 */

import {
  GetFunctionConcurrencyCommand,
  GetFunctionEventInvokeConfigCommand,
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionConfigurationCommand,
  ListEventSourceMappingsCommand,
  ListProvisionedConcurrencyConfigsCommand,
  ListTagsCommand,
  type DestinationConfig,
  type EventSourceMappingConfiguration,
  type FunctionConfiguration,
  type FunctionEventInvokeConfig,
  type ProvisionedConcurrencyConfigListItem,
} from '@aws-sdk/client-lambda';
import type { DiscoveredResource } from '../../../types/discovery.js';
import {
  EdgeType,
  type LambdaAsyncInvokeConfig,
  type LambdaDependencyEdgeAttributes,
  type LambdaDestinationTarget,
  type LambdaEventSourceMappingAttributes,
  type LambdaEventSourceMappingDestinationConfig,
  type LambdaFunctionMetadata,
  type LambdaLayerAttributes,
  type LambdaProvisionedConcurrencyAttributes,
} from '../../../types/infrastructure.js';
import {
  computeRetryDelayMs,
  getAwsFailureType,
  isAwsThrottlingError,
  type AwsRetryPolicy,
} from '../aws-retry-utils.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import {
  createAccountContextResolver,
  createResource,
  paginateAws,
  sleep,
} from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, normalizeTagMap } from '../tag-utils.js';

const LAMBDA_READ_RETRY_POLICY: AwsRetryPolicy = {
  maxAttempts: 4,
  initialBackoffMs: 100,
  backoffMultiplier: 2,
  maxJitterMs: 0,
};
const DEFAULT_ASYNC_MAXIMUM_RETRY_ATTEMPTS = 2;
const DEFAULT_ASYNC_MAXIMUM_EVENT_AGE_SECONDS = 21_600;

const LAMBDA_ENV_ARN_PATTERN = /arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[A-Za-z0-9\-_/.:]+/g;
const LAMBDA_ENV_SQS_URL_PATTERN =
  /https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/[A-Za-z0-9\-_]+/g;
const LAMBDA_ENV_RDS_ENDPOINT_PATTERN =
  /[A-Za-z0-9\-]+\.[A-Za-z0-9\-]+\.[A-Za-z0-9-]+\.rds\.amazonaws\.com/g;
const LAMBDA_ENV_CACHE_ENDPOINT_PATTERN = /[A-Za-z0-9\-]+\.[A-Za-z0-9\-]+\.cache\.amazonaws\.com/g;

interface LambdaEnvReference {
  readonly varName: string;
  readonly referenceType: string;
  readonly value: string;
}

function extractLambdaEnvironmentReferences(envVars: Record<string, string>): LambdaEnvReference[] {
  const references: LambdaEnvReference[] = [];

  for (const [varName, rawValue] of Object.entries(envVars)) {
    if (typeof rawValue !== 'string') continue;
    const value = rawValue.trim();
    if (!value) continue;
    let matchedExplicit = false;

    for (const match of value.match(LAMBDA_ENV_ARN_PATTERN) ?? []) {
      references.push({ varName, referenceType: 'arn', value: match });
      matchedExplicit = true;
    }
    for (const match of value.match(LAMBDA_ENV_SQS_URL_PATTERN) ?? []) {
      references.push({ varName, referenceType: 'sqs_url', value: match });
      matchedExplicit = true;
    }
    for (const match of value.match(LAMBDA_ENV_RDS_ENDPOINT_PATTERN) ?? []) {
      references.push({ varName, referenceType: 'rds_endpoint', value: match });
      matchedExplicit = true;
    }
    for (const match of value.match(LAMBDA_ENV_CACHE_ENDPOINT_PATTERN) ?? []) {
      references.push({ varName, referenceType: 'cache_endpoint', value: match });
      matchedExplicit = true;
    }

    if (!matchedExplicit) {
      const upperName = varName.toUpperCase();
      if (upperName.includes('TABLE')) {
        references.push({ varName, referenceType: 'dynamodb_table', value });
      } else if (upperName.includes('BUCKET')) {
        references.push({ varName, referenceType: 's3_bucket', value });
      } else if (upperName.includes('QUEUE')) {
        references.push({ varName, referenceType: 'queue_name', value });
      } else if (upperName.includes('TOPIC')) {
        references.push({ varName, referenceType: 'topic_name', value });
      }
    }
  }

  return references;
}

async function sendLambdaWithRetry<TValue>(action: () => Promise<TValue>): Promise<TValue> {
  let retryCount = 0;

  for (let attempt = 1; attempt <= LAMBDA_READ_RETRY_POLICY.maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (isAwsThrottlingError(error) && attempt < LAMBDA_READ_RETRY_POLICY.maxAttempts) {
        retryCount += 1;
        await sleep(computeRetryDelayMs(retryCount, LAMBDA_READ_RETRY_POLICY, () => 0));
        continue;
      }
      throw error;
    }
  }

  throw new Error('Lambda retry loop exhausted unexpectedly.');
}

function isResourceNotFoundError(error: unknown): boolean {
  return getAwsFailureType(error) === 'ResourceNotFoundException';
}

function toDestinationTarget(value: string | undefined): LambdaDestinationTarget | null {
  const destination = value?.trim();
  return destination ? { destination } : null;
}

function summarizeAsyncDestinationConfig(
  config: DestinationConfig | undefined,
): LambdaAsyncInvokeConfig['destinationConfig'] {
  const onSuccess = toDestinationTarget(config?.OnSuccess?.Destination);
  const onFailure = toDestinationTarget(config?.OnFailure?.Destination);
  if (!onSuccess && !onFailure) return null;
  return { onSuccess, onFailure };
}

function summarizeEventSourceDestinationConfig(
  config: DestinationConfig | undefined,
): LambdaEventSourceMappingDestinationConfig | null {
  const onFailure = toDestinationTarget(config?.OnFailure?.Destination);
  return onFailure ? { onFailure } : null;
}

function summarizeAsyncInvokeConfig(config: FunctionEventInvokeConfig): LambdaAsyncInvokeConfig {
  return {
    maximumRetryAttempts:
      config.MaximumRetryAttempts ?? DEFAULT_ASYNC_MAXIMUM_RETRY_ATTEMPTS,
    maximumEventAgeInSeconds:
      config.MaximumEventAgeInSeconds ?? DEFAULT_ASYNC_MAXIMUM_EVENT_AGE_SECONDS,
    destinationConfig: summarizeAsyncDestinationConfig(config.DestinationConfig),
  };
}

function summarizeEventSourceMapping(
  mapping: EventSourceMappingConfiguration,
): LambdaEventSourceMappingAttributes {
  return {
    uuid: mapping.UUID ?? '',
    eventSourceArn: mapping.EventSourceArn ?? '',
    state: mapping.State ?? '',
    batchSize: mapping.BatchSize ?? null,
    maximumRetryAttempts: mapping.MaximumRetryAttempts ?? null,
    bisectBatchOnFunctionError: mapping.BisectBatchOnFunctionError ?? null,
    destinationConfig: summarizeEventSourceDestinationConfig(mapping.DestinationConfig),
    functionResponseTypes: (mapping.FunctionResponseTypes ?? []).map((responseType) =>
      String(responseType),
    ),
  };
}

function summarizeLayers(configuration: FunctionConfiguration | null): LambdaLayerAttributes[] {
  return (configuration?.Layers ?? [])
    .map((layer) => {
      const arn = layer.Arn?.trim();
      if (!arn) return null;
      return {
        arn,
        codeSize: layer.CodeSize ?? 0,
      };
    })
    .filter((layer): layer is LambdaLayerAttributes => layer !== null);
}

function extractAliasOrVersion(functionArn: string | undefined): string {
  const segments = functionArn?.split(':') ?? [];
  if (segments.length >= 8 && segments[5] === 'function') {
    return segments.slice(7).join(':') || '$LATEST';
  }
  return '$LATEST';
}

function summarizeProvisionedConcurrencyConfig(
  config: ProvisionedConcurrencyConfigListItem,
): LambdaProvisionedConcurrencyAttributes {
  return {
    allocatedConcurrency: config.AllocatedProvisionedConcurrentExecutions ?? 0,
    availableConcurrency: config.AvailableProvisionedConcurrentExecutions ?? 0,
    status: config.Status ?? '',
    aliasOrVersion: extractAliasOrVersion(config.FunctionArn),
  };
}

function selectProvisionedConcurrency(
  configs: readonly ProvisionedConcurrencyConfigListItem[],
): LambdaProvisionedConcurrencyAttributes | null {
  const summaries = configs
    .map(summarizeProvisionedConcurrencyConfig)
    .sort((left, right) => left.aliasOrVersion.localeCompare(right.aliasOrVersion));
  return summaries.find((config) => config.status !== 'READY') ?? summaries[0] ?? null;
}

function summarizeProvisionedConcurrencyConfigs(
  configs: readonly ProvisionedConcurrencyConfigListItem[],
): Array<Record<string, unknown>> {
  return configs.map((config) => ({
    functionArn: config.FunctionArn,
    requestedProvisionedConcurrentExecutions:
      config.RequestedProvisionedConcurrentExecutions,
    availableProvisionedConcurrentExecutions:
      config.AvailableProvisionedConcurrentExecutions,
    allocatedProvisionedConcurrentExecutions:
      config.AllocatedProvisionedConcurrentExecutions,
    status: config.Status,
    statusReason: config.StatusReason,
    lastModified: config.LastModified,
    aliasOrVersion: extractAliasOrVersion(config.FunctionArn),
  }));
}

function normalizeLambdaEventSourceDependencyArn(eventSourceArn: string): string {
  const streamMarker = '/stream/';
  if (eventSourceArn.includes(':dynamodb:') && eventSourceArn.includes(streamMarker)) {
    return eventSourceArn.slice(0, eventSourceArn.indexOf(streamMarker));
  }
  return eventSourceArn;
}

function pushDependencyEdge(
  target: LambdaDependencyEdgeAttributes[],
  edge: LambdaDependencyEdgeAttributes,
): void {
  const source = edge.source ?? '';
  if (!edge.target || source === edge.target) return;
  target.push(edge);
}

function buildLambdaDependencyEdges(input: {
  readonly functionArn: string;
  readonly deadLetterTargetArn: string | null;
  readonly eventSourceMappings: readonly LambdaEventSourceMappingAttributes[];
  readonly asyncInvokeConfig: LambdaAsyncInvokeConfig | null;
}): LambdaDependencyEdgeAttributes[] {
  const edges: LambdaDependencyEdgeAttributes[] = [];

  if (input.deadLetterTargetArn) {
    pushDependencyEdge(edges, {
      target: input.deadLetterTargetArn,
      type: EdgeType.DEAD_LETTER,
      relationship: 'lambda_dead_letter_queue',
    });
  }

  for (const mapping of input.eventSourceMappings) {
    const eventSourceArn = mapping.eventSourceArn.trim();
    if (eventSourceArn) {
      pushDependencyEdge(edges, {
        source: normalizeLambdaEventSourceDependencyArn(eventSourceArn),
        target: input.functionArn,
        type: EdgeType.TRIGGERS,
        relationship: 'lambda_event_source',
        metadata: {
          eventSourceArn,
          uuid: mapping.uuid,
          state: mapping.state,
        },
      });
    }

    const onFailure = mapping.destinationConfig?.onFailure?.destination;
    if (onFailure) {
      pushDependencyEdge(edges, {
        target: onFailure,
        type: EdgeType.DEAD_LETTER,
        relationship: 'lambda_event_source_on_failure_destination',
        metadata: {
          eventSourceArn,
          uuid: mapping.uuid,
        },
      });
    }
  }

  const onSuccess = input.asyncInvokeConfig?.destinationConfig?.onSuccess?.destination;
  if (onSuccess) {
    pushDependencyEdge(edges, {
      target: onSuccess,
      type: EdgeType.PUBLISHES_TO_APPLICATIVE,
      relationship: 'lambda_async_on_success_destination',
    });
  }

  const onFailure = input.asyncInvokeConfig?.destinationConfig?.onFailure?.destination;
  if (onFailure) {
    pushDependencyEdge(edges, {
      target: onFailure,
      type: EdgeType.DEAD_LETTER,
      relationship: 'lambda_async_on_failure_destination',
    });
  }

  return edges;
}

export async function scanLambdaFunctions(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const lambda = createAwsClient(LambdaClient, options);
  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  const tagWarnings = new Set<string>();
  const resolveAccountContext = createAccountContextResolver(options);

  const lambdas = await paginateAws(
    (marker) =>
      lambda.send(new ListFunctionsCommand({ Marker: marker }), getAwsCommandOptions(options)),
    (response) => response.Functions,
    (response) => response.NextMarker,
  );

  for (const fn of lambdas) {
    const fallbackFunctionName = fn.FunctionName ?? 'lambda';
    let accountContext = fn.FunctionArn ? null : await resolveAccountContext();
    if (!fn.FunctionArn && !accountContext) {
      accountContext = await resolveAccountContext();
    }
    const functionArn = fn.FunctionArn
      ? fn.FunctionArn
      : `arn:${accountContext?.partition ?? 'aws'}:lambda:${options.region}:${accountContext?.accountId ?? ''}:function:${fallbackFunctionName}`;
    let configuration: FunctionConfiguration | null = null;
    let environmentReferences: LambdaEnvReference[] = [];
    let environmentVariableNames: string[] = [];
    let eventSourceMappings: LambdaEventSourceMappingAttributes[] = [];
    let functionRoleArn: string | null = null;
    let vpcId: string | null = null;
    let subnetIds: string[] = [];
    let securityGroups: string[] = [];
    let deadLetterTargetArn: string | null = null;
    let asyncInvokeConfig: LambdaAsyncInvokeConfig | null = null;
    let onSuccessDestinationArn: string | null = null;
    let onFailureDestinationArn: string | null = null;
    let provisionedConcurrencyConfigs: Array<Record<string, unknown>> = [];
    let provisionedConcurrency: LambdaProvisionedConcurrencyAttributes | null = null;
    let reservedConcurrency: number | null = null;
    const tags = fn.FunctionArn
      ? await fetchAwsTagsWithRetry(
          () =>
            sendLambdaWithRetry(() =>
              lambda.send(
                new ListTagsCommand({ Resource: fn.FunctionArn! }),
                getAwsCommandOptions(options),
              ),
            ),
          (response) => normalizeTagMap(response.Tags),
          {
            description: `Lambda tag discovery unavailable in ${options.region}`,
            warnings,
            warningDeduper: tagWarnings,
          },
        )
      : {};
    const displayName = getNameTag(tags) ?? fn.FunctionName ?? 'lambda';

    try {
      configuration = await sendLambdaWithRetry(() =>
        lambda.send(
          new GetFunctionConfigurationCommand({
            FunctionName: fn.FunctionName ?? fn.FunctionArn,
          }),
          getAwsCommandOptions(options),
        ),
      );
      const variables = configuration.Environment?.Variables ?? {};
      environmentVariableNames = Object.keys(variables);
      environmentReferences = extractLambdaEnvironmentReferences(variables);
      functionRoleArn = configuration.Role ?? null;
      vpcId = configuration.VpcConfig?.VpcId ?? null;
      subnetIds = (configuration.VpcConfig?.SubnetIds ?? []).filter((id): id is string =>
        Boolean(id),
      );
      securityGroups = (configuration.VpcConfig?.SecurityGroupIds ?? []).filter(
        (id): id is string => Boolean(id),
      );
      deadLetterTargetArn = configuration.DeadLetterConfig?.TargetArn ?? null;
    } catch (error) {
      warnings.push(
        `Lambda details unavailable for ${fn.FunctionName ?? fallbackFunctionName} in ${options.region} (${getAwsFailureType(error)}).`,
      );
    }

    try {
      const invokeConfig = await sendLambdaWithRetry(() =>
        lambda.send(
          new GetFunctionEventInvokeConfigCommand({
            FunctionName: fn.FunctionName ?? fn.FunctionArn,
          }),
          getAwsCommandOptions(options),
        ),
      );
      asyncInvokeConfig = summarizeAsyncInvokeConfig(invokeConfig);
      onSuccessDestinationArn =
        asyncInvokeConfig.destinationConfig?.onSuccess?.destination ?? null;
      onFailureDestinationArn =
        asyncInvokeConfig.destinationConfig?.onFailure?.destination ?? null;
    } catch (error) {
      if (!isResourceNotFoundError(error)) {
        warnings.push(
          `Lambda invoke configuration unavailable for ${fn.FunctionName ?? fallbackFunctionName} in ${options.region} (${getAwsFailureType(error)}).`,
        );
      }
    }

    try {
      const mappings = await paginateAws(
        (marker) =>
          sendLambdaWithRetry(() =>
            lambda.send(
              new ListEventSourceMappingsCommand({
                FunctionName: fn.FunctionName ?? fn.FunctionArn,
                Marker: marker,
              }),
              getAwsCommandOptions(options),
            ),
          ),
        (response) => response.EventSourceMappings,
        (response) => response.NextMarker,
      );
      eventSourceMappings = mappings.map(summarizeEventSourceMapping);
    } catch (error) {
      warnings.push(
        `Lambda event source mappings unavailable for ${fn.FunctionName ?? fallbackFunctionName} in ${options.region} (${getAwsFailureType(error)}).`,
      );
    }

    try {
      const concurrency = await sendLambdaWithRetry(() =>
        lambda.send(
          new GetFunctionConcurrencyCommand({
            FunctionName: fn.FunctionName ?? fn.FunctionArn,
          }),
          getAwsCommandOptions(options),
        ),
      );
      reservedConcurrency = concurrency.ReservedConcurrentExecutions ?? null;
    } catch (error) {
      warnings.push(
        `Lambda reserved concurrency unavailable for ${fn.FunctionName ?? fallbackFunctionName} in ${options.region} (${getAwsFailureType(error)}).`,
      );
    }

    try {
      const configs = await paginateAws(
        (marker) =>
          sendLambdaWithRetry(() =>
            lambda.send(
              new ListProvisionedConcurrencyConfigsCommand({
                FunctionName: fn.FunctionName ?? fn.FunctionArn,
                Marker: marker,
              }),
              getAwsCommandOptions(options),
            ),
          ),
        (response) => response.ProvisionedConcurrencyConfigs,
        (response) => response.NextMarker,
      );
      provisionedConcurrency = selectProvisionedConcurrency(configs);
      provisionedConcurrencyConfigs = summarizeProvisionedConcurrencyConfigs(configs);
    } catch (error) {
      warnings.push(
        `Lambda provisioned concurrency unavailable for ${fn.FunctionName ?? fallbackFunctionName} in ${options.region} (${getAwsFailureType(error)}).`,
      );
    }

    const deadLetterConfig = deadLetterTargetArn ? { targetArn: deadLetterTargetArn } : null;
    const layers = summarizeLayers(configuration);
    const directDependencyEdges = buildLambdaDependencyEdges({
      functionArn,
      deadLetterTargetArn,
      eventSourceMappings,
      asyncInvokeConfig,
    });
    const metadata = {
      runtime: configuration?.Runtime ?? fn.Runtime ?? null,
      handler: configuration?.Handler ?? fn.Handler ?? null,
      functionName: configuration?.FunctionName ?? fn.FunctionName ?? fallbackFunctionName,
      functionArn,
      timeout: configuration?.Timeout ?? fn.Timeout ?? null,
      memorySize: configuration?.MemorySize ?? fn.MemorySize ?? null,
      roleArn: functionRoleArn,
      region: options.region,
      vpcId,
      subnetId: subnetIds[0] ?? null,
      subnetIds,
      securityGroups,
      deadLetterConfig,
      deadLetterTargetArn,
      asyncInvokeConfig,
      eventInvokeConfig: asyncInvokeConfig,
      onSuccessDestinationArn,
      onFailureDestinationArn,
      environmentVariableNames,
      environmentReferences,
      eventSourceMappings,
      provisionedConcurrency,
      provisionedConcurrencyConfigs,
      provisionedConcurrencyEnabled: provisionedConcurrency !== null,
      reservedConcurrency,
      layers,
      directDependencyEdges,
      displayName,
      ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
    } satisfies LambdaFunctionMetadata;

    resources.push(
      createResource({
        source: 'aws',
        arn: functionArn,
        name: displayName,
        kind: 'service',
        type: 'LAMBDA',
        ...(accountContext ? { account: accountContext } : {}),
        tags,
        metadata,
      }),
    );
  }

  return { resources, warnings };
}
