import { getMetadata, readBoolean, readNumber, readString } from '../../graph/analysis-helpers.js';
import type {
  InfraNode,
  ValidationResult,
  ValidationRule,
} from '../validation-types.js';

function createResult(
  ruleId: string,
  node: InfraNode,
  status: ValidationResult['status'],
  message: string,
  details?: Record<string, unknown>,
  remediation?: string,
): ValidationResult {
  return {
    ruleId,
    nodeId: node.id,
    status,
    message,
    ...(details ? { details } : {}),
    ...(remediation ? { remediation } : {}),
  };
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readObjectArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readObject(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function readOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return readNumber(value);
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => readString(entry)).filter((entry): entry is string => entry !== null);
}

function destinationFrom(value: unknown): string | null {
  return readString(readObject(value)?.destination);
}

function destinationConfigFrom(metadata: Record<string, unknown>): Record<string, unknown> | null {
  const asyncInvokeConfig =
    readObject(metadata.asyncInvokeConfig) ?? readObject(metadata.eventInvokeConfig);
  return readObject(asyncInvokeConfig?.destinationConfig);
}

function asyncOnFailureDestination(metadata: Record<string, unknown>): string | null {
  const destinationConfig = destinationConfigFrom(metadata);
  return (
    destinationFrom(destinationConfig?.onFailure) ??
    readString(destinationConfig?.onFailureDestination) ??
    readString(metadata.onFailureDestinationArn)
  );
}

function hasDeadLetterTarget(metadata: Record<string, unknown>): boolean {
  const deadLetterConfig = readObject(metadata.deadLetterConfig);
  return (
    readString(deadLetterConfig?.targetArn) !== null ||
    readString(metadata.deadLetterTargetArn) !== null
  );
}

function eventSourceMappings(node: InfraNode): readonly Record<string, unknown>[] {
  return readObjectArray(getMetadata(node).eventSourceMappings);
}

function hasEventSourceFailureDestination(mappings: readonly Record<string, unknown>[]): boolean {
  return mappings.some((mapping) => {
    const destinationConfig = readObject(mapping.destinationConfig);
    return destinationFrom(destinationConfig?.onFailure) !== null;
  });
}

function isAsyncSourceArn(sourceArn: string): boolean {
  return (
    sourceArn.includes(':sqs:') ||
    sourceArn.includes(':sns:') ||
    sourceArn.includes(':events:') ||
    sourceArn.includes(':eventbridge:')
  );
}

function processesAsyncEvents(metadata: Record<string, unknown>, mappings: readonly Record<string, unknown>[]): boolean {
  if (readObject(metadata.asyncInvokeConfig) ?? readObject(metadata.eventInvokeConfig)) return true;
  if (readString(metadata.onSuccessDestinationArn) || readString(metadata.onFailureDestinationArn)) {
    return true;
  }
  return mappings
    .map((mapping) => readString(mapping.eventSourceArn))
    .filter((sourceArn): sourceArn is string => sourceArn !== null)
    .some(isAsyncSourceArn);
}

function streamSourceLabel(sourceArn: string): string | null {
  if (sourceArn.includes(':dynamodb:') && sourceArn.includes('/stream/')) return 'DynamoDB';
  if (sourceArn.includes(':kinesis:') && sourceArn.includes(':stream/')) return 'Kinesis';
  return null;
}

function hasPartialFailureReporting(mapping: Record<string, unknown>): boolean {
  return readStringArray(mapping.functionResponseTypes).some(
    (responseType) => responseType === 'ReportBatchItemFailures',
  );
}

function isCriticalLambda(node: InfraNode): boolean {
  const metadata = getMetadata(node);
  const criticality = readString(metadata.criticality)?.toLowerCase();
  if (criticality === 'critical' || criticality === 'high') return true;
  if (typeof node.criticalityScore === 'number' && node.criticalityScore >= 70) return true;

  const roleValues = [
    metadata.serviceRole,
    metadata.businessRole,
    metadata.workloadRole,
    metadata.roleCategory,
    metadata.drRole,
  ]
    .map((value) => readString(value)?.toLowerCase())
    .filter((value): value is string => value !== undefined && value !== null);

  return roleValues.some((role) => role === 'compute' || role === 'datastore');
}

function hasProvisionedConcurrency(metadata: Record<string, unknown>): boolean {
  return (
    readObject(metadata.provisionedConcurrency) !== null ||
    readObjectArray(metadata.provisionedConcurrencyConfigs).length > 0
  );
}

function provisionedConcurrencyStatuses(metadata: Record<string, unknown>): readonly string[] {
  const primary = readObject(metadata.provisionedConcurrency);
  const primaryStatus = readString(primary?.status);
  const rawStatuses = readObjectArray(metadata.provisionedConcurrencyConfigs)
    .map((config) => readString(config.status))
    .filter((status): status is string => status !== null);
  return Array.from(new Set([primaryStatus, ...rawStatuses].filter((status): status is string => status !== null)));
}

const lambdaNoDlqRule: ValidationRule = {
  id: 'LAMBDA_NO_DLQ',
  name: 'Lambda Async Failure Destination',
  description: 'Checks whether asynchronous Lambda processing has a DLQ or failure destination.',
  category: 'recovery',
  severity: 'high',
  appliesToTypes: ['lambda'],
  observedKeys: [
    'deadLetterConfig.targetArn',
    'asyncInvokeConfig.destinationConfig.onFailure',
    'eventSourceMappings.destinationConfig.onFailure',
  ],
  validate: (node) => {
    const metadata = getMetadata(node);
    const mappings = eventSourceMappings(node);
    const functionName = readString(metadata.functionName) ?? node.name;

    if (!processesAsyncEvents(metadata, mappings)) {
      return createResult(
        lambdaNoDlqRule.id,
        node,
        'skip',
        `Lambda '${functionName}' has no asynchronous event source visible in this scan.`,
      );
    }

    const hasFailureSink =
      hasDeadLetterTarget(metadata) ||
      asyncOnFailureDestination(metadata) !== null ||
      hasEventSourceFailureDestination(mappings);
    return hasFailureSink
      ? createResult(
          lambdaNoDlqRule.id,
          node,
          'pass',
          `Lambda '${functionName}' has a dead letter queue or failure destination.`,
        )
      : createResult(
          lambdaNoDlqRule.id,
          node,
          'fail',
          `Lambda '${functionName}' processes async events but has no dead letter queue or failure destination. Failed invocations during DR recovery will be silently lost.`,
          { asyncEventSourceCount: mappings.length },
          'Configure a Lambda DLQ or on-failure destination for asynchronous processing.',
        );
  },
};

const lambdaEventSourceDisabledRule: ValidationRule = {
  id: 'LAMBDA_EVENT_SOURCE_DISABLED',
  name: 'Lambda Event Source Enabled',
  description: 'Checks whether Lambda event source mappings are enabled.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['lambda'],
  observedKeys: ['eventSourceMappings.state'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const functionName = readString(metadata.functionName) ?? node.name;
    const disabled = eventSourceMappings(node).filter(
      (mapping) => readString(mapping.state)?.toLowerCase() === 'disabled',
    );
    if (disabled.length === 0) {
      return createResult(
        lambdaEventSourceDisabledRule.id,
        node,
        'pass',
        `Lambda '${functionName}' has no disabled event source mappings.`,
      );
    }

    const sourceArn = readString(disabled[0]?.eventSourceArn) ?? 'unknown source';
    return createResult(
      lambdaEventSourceDisabledRule.id,
      node,
      'fail',
      `Lambda '${functionName}' has a disabled event source mapping from ${sourceArn}. This trigger will not automatically reconnect after a DR event.`,
      { disabledEventSourceMappings: disabled.length, sourceArn },
      'Enable the event source mapping or remove it from the recovery path.',
    );
  },
};

const lambdaNoReservedConcurrencyRule: ValidationRule = {
  id: 'LAMBDA_NO_RESERVED_CONCURRENCY',
  name: 'Lambda Reserved Concurrency',
  description: 'Checks whether critical Lambda functions have isolated or pre-warmed concurrency.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['lambda'],
  observedKeys: ['reservedConcurrency', 'provisionedConcurrency'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const functionName = readString(metadata.functionName) ?? node.name;
    if (!isCriticalLambda(node)) {
      return createResult(
        lambdaNoReservedConcurrencyRule.id,
        node,
        'pass',
        `Lambda '${functionName}' is not marked critical for concurrency isolation.`,
      );
    }

    const hasReserved = readOptionalNumber(metadata.reservedConcurrency) !== null;
    const hasProvisioned = hasProvisionedConcurrency(metadata);
    return hasReserved || hasProvisioned
      ? createResult(
          lambdaNoReservedConcurrencyRule.id,
          node,
          'pass',
          `Lambda '${functionName}' has reserved or provisioned concurrency.`,
        )
      : createResult(
          lambdaNoReservedConcurrencyRule.id,
          node,
          'fail',
          `Lambda '${functionName}' has no reserved or provisioned concurrency. During a DR event with traffic surge, it may be throttled by other functions consuming the account concurrency pool.`,
          { reservedConcurrency: null, provisionedConcurrency: null },
          'Configure reserved concurrency or provisioned concurrency for critical Lambda recovery paths.',
        );
  },
};

const lambdaProvisionedNotReadyRule: ValidationRule = {
  id: 'LAMBDA_PROVISIONED_NOT_READY',
  name: 'Lambda Provisioned Concurrency Ready',
  description: 'Checks whether provisioned concurrency is ready for recovery traffic.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['lambda'],
  observedKeys: ['provisionedConcurrency.status', 'provisionedConcurrencyConfigs.status'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const functionName = readString(metadata.functionName) ?? node.name;
    const statuses = provisionedConcurrencyStatuses(metadata);
    if (statuses.length === 0) {
      return createResult(
        lambdaProvisionedNotReadyRule.id,
        node,
        'pass',
        `Lambda '${functionName}' has no provisioned concurrency configuration.`,
      );
    }

    const notReady = statuses.find((status) => status !== 'READY');
    return notReady
      ? createResult(
          lambdaProvisionedNotReadyRule.id,
          node,
          'fail',
          `Lambda '${functionName}' has provisioned concurrency in status '${notReady}'. Cold starts will occur during recovery until provisioned capacity is ready.`,
          { statuses },
          'Wait for provisioned concurrency to reach READY or repair the failed allocation.',
        )
      : createResult(
          lambdaProvisionedNotReadyRule.id,
          node,
          'pass',
          `Lambda '${functionName}' provisioned concurrency is ready.`,
          { statuses },
        );
  },
};

const lambdaEsmNoBisectRule: ValidationRule = {
  id: 'LAMBDA_ESM_NO_BISECT',
  name: 'Lambda Stream Partial Failure Handling',
  description: 'Checks whether stream event source mappings can isolate bad records.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['lambda'],
  observedKeys: [
    'eventSourceMappings.bisectBatchOnFunctionError',
    'eventSourceMappings.functionResponseTypes',
  ],
  validate: (node) => {
    const metadata = getMetadata(node);
    const functionName = readString(metadata.functionName) ?? node.name;
    const stalledStreams = eventSourceMappings(node).filter((mapping) => {
      const sourceArn = readString(mapping.eventSourceArn);
      if (!sourceArn || !streamSourceLabel(sourceArn)) return false;
      return (
        readBoolean(mapping.bisectBatchOnFunctionError) !== true &&
        !hasPartialFailureReporting(mapping)
      );
    });

    if (stalledStreams.length === 0) {
      return createResult(
        lambdaEsmNoBisectRule.id,
        node,
        'pass',
        `Lambda '${functionName}' stream event sources support bad-record isolation or are not stream based.`,
      );
    }

    const sourceArn = readString(stalledStreams[0]?.eventSourceArn) ?? 'unknown source';
    const source = streamSourceLabel(sourceArn) ?? 'stream';
    return createResult(
      lambdaEsmNoBisectRule.id,
      node,
      'fail',
      `Lambda '${functionName}' processes ${source} stream without batch bisection or partial failure reporting. A single bad record will block the entire shard, causing data processing to stall during recovery.`,
      { sourceArn },
      'Enable BisectBatchOnFunctionError or ReportBatchItemFailures for stream event sources.',
    );
  },
};

export const lambdaValidationRules: readonly ValidationRule[] = [
  lambdaNoDlqRule,
  lambdaEventSourceDisabledRule,
  lambdaNoReservedConcurrencyRule,
  lambdaProvisionedNotReadyRule,
  lambdaEsmNoBisectRule,
];
