import { getMetadata, readBoolean, readString } from '../../graph/analysis-helpers.js';
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

function taskStates(node: InfraNode): readonly Record<string, unknown>[] {
  return readObjectArray(readObject(getMetadata(node).parsedDefinition)?.taskStates);
}

function taskName(task: Record<string, unknown>): string {
  return readString(task.name) ?? 'unknown task';
}

function stateMachineName(node: InfraNode): string {
  const metadata = getMetadata(node);
  return readString(metadata.stateMachineName) ?? readString(metadata.name) ?? node.name;
}

function hasTimeoutOrHeartbeat(task: Record<string, unknown>): boolean {
  return (
    (task.timeoutSeconds !== null && task.timeoutSeconds !== undefined) ||
    (task.heartbeatSeconds !== null && task.heartbeatSeconds !== undefined)
  );
}

function hasRetry(task: Record<string, unknown>): boolean {
  return readObjectArray(task.retry).length > 0;
}

function hasCatch(task: Record<string, unknown>): boolean {
  return readObjectArray(task.catch).length > 0;
}

function isTerminal(task: Record<string, unknown>): boolean {
  return readBoolean(task.isTerminal) === true || readBoolean(task.end) === true;
}

function externalService(task: Record<string, unknown>): string | null {
  const service = readString(task.service);
  if (service === 'Lambda' || service === 'ECS' || service === 'SQS') return service;

  const resource = readString(task.resource) ?? '';
  if (resource.includes(':lambda:') || resource.includes(':states:::lambda:invoke')) {
    return 'Lambda';
  }
  if (resource.includes(':states:::ecs:runTask')) return 'ECS';
  if (resource.includes(':states:::sqs:sendMessage')) return 'SQS';
  return null;
}

function loggingLevel(node: InfraNode): string {
  const loggingConfiguration = readObject(getMetadata(node).loggingConfiguration);
  return (readString(loggingConfiguration?.level) ?? 'OFF').toUpperCase();
}

function loggingDisabled(node: InfraNode): boolean {
  return readObject(getMetadata(node).loggingConfiguration) === null || loggingLevel(node) === 'OFF';
}

const sfnTaskNoTimeoutRule: ValidationRule = {
  id: 'SFN_TASK_NO_TIMEOUT',
  name: 'Step Functions Task Timeout',
  description: 'Checks whether Step Functions task states can hang indefinitely.',
  category: 'recovery',
  severity: 'high',
  appliesToTypes: ['sfn-state-machine', 'step-function-state-machine'],
  observedKeys: [
    'parsedDefinition.taskStates.timeoutSeconds',
    'parsedDefinition.taskStates.heartbeatSeconds',
  ],
  validate: (node) => {
    const name = stateMachineName(node);
    const task = taskStates(node).find((candidate) => !hasTimeoutOrHeartbeat(candidate));

    return task
      ? createResult(
          sfnTaskNoTimeoutRule.id,
          node,
          'fail',
          `Step Functions '${name}' has task state '${taskName(task)}' with no timeout. A stuck execution during DR recovery will hang indefinitely, consuming capacity.`,
          { taskName: taskName(task) },
          'Set TimeoutSeconds or HeartbeatSeconds on the task state.',
        )
      : createResult(
          sfnTaskNoTimeoutRule.id,
          node,
          'pass',
          `Step Functions '${name}' task states have timeout or heartbeat controls.`,
        );
  },
};

const sfnTaskNoRetryRule: ValidationRule = {
  id: 'SFN_TASK_NO_RETRY',
  name: 'Step Functions Task Retry',
  description: 'Checks whether external service task states retry transient failures.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['sfn-state-machine', 'step-function-state-machine'],
  observedKeys: ['parsedDefinition.taskStates.retry'],
  validate: (node) => {
    const name = stateMachineName(node);
    const task = taskStates(node).find(
      (candidate) => externalService(candidate) && !hasRetry(candidate),
    );
    const service = task ? externalService(task) : null;

    return task && service
      ? createResult(
          sfnTaskNoRetryRule.id,
          node,
          'fail',
          `Step Functions '${name}' has task state '${taskName(task)}' invoking ${service} without retry. Transient failures during DR recovery will immediately fail the execution.`,
          { taskName: taskName(task), service },
          'Add a Retry block for transient service errors.',
        )
      : createResult(
          sfnTaskNoRetryRule.id,
          node,
          'pass',
          `Step Functions '${name}' external task states have retry configured or no external task states are present.`,
        );
  },
};

const sfnTaskNoCatchRule: ValidationRule = {
  id: 'SFN_TASK_NO_CATCH',
  name: 'Step Functions Task Catch',
  description: 'Checks whether non-terminal task states have error catch paths.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['sfn-state-machine', 'step-function-state-machine'],
  observedKeys: ['parsedDefinition.taskStates.catch'],
  validate: (node) => {
    const name = stateMachineName(node);
    const task = taskStates(node).find(
      (candidate) => !hasCatch(candidate) && !isTerminal(candidate),
    );

    return task
      ? createResult(
          sfnTaskNoCatchRule.id,
          node,
          'fail',
          `Step Functions '${name}' has task state '${taskName(task)}' without error catch. An unhandled error will terminate the entire state machine execution.`,
          { taskName: taskName(task) },
          'Add a Catch transition to a recovery or compensation state.',
        )
      : createResult(
          sfnTaskNoCatchRule.id,
          node,
          'pass',
          `Step Functions '${name}' non-terminal task states have error catch handling.`,
        );
  },
};

const sfnLoggingDisabledRule: ValidationRule = {
  id: 'SFN_LOGGING_DISABLED',
  name: 'Step Functions Logging',
  description: 'Checks whether Step Functions execution logging is enabled.',
  category: 'detection',
  severity: 'low',
  appliesToTypes: ['sfn-state-machine', 'step-function-state-machine'],
  observedKeys: ['loggingConfiguration.level'],
  validate: (node) => {
    const name = stateMachineName(node);
    return loggingDisabled(node)
      ? createResult(
          sfnLoggingDisabledRule.id,
          node,
          'fail',
          `Step Functions '${name}' has logging disabled. Failed executions during DR will not be traceable.`,
          { level: loggingLevel(node) },
          'Enable CloudWatch Logs for execution failures.',
        )
      : createResult(
          sfnLoggingDisabledRule.id,
          node,
          'pass',
          `Step Functions '${name}' has logging enabled.`,
          { level: loggingLevel(node) },
        );
  },
};

const sfnExpressNoLoggingRule: ValidationRule = {
  id: 'SFN_EXPRESS_NO_LOGGING',
  name: 'Express Step Functions Logging',
  description: 'Checks whether Express workflows have CloudWatch logging for execution history.',
  category: 'detection',
  severity: 'high',
  appliesToTypes: ['sfn-state-machine', 'step-function-state-machine'],
  observedKeys: ['type', 'loggingConfiguration.level'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const name = stateMachineName(node);
    const type = (
      readString(metadata.type) ??
      readString(metadata.stateMachineType) ??
      ''
    ).toUpperCase();

    if (type !== 'EXPRESS') {
      return createResult(
        sfnExpressNoLoggingRule.id,
        node,
        'skip',
        `Step Functions '${name}' is not an Express workflow.`,
        { type },
      );
    }

    return loggingDisabled(node)
      ? createResult(
          sfnExpressNoLoggingRule.id,
          node,
          'fail',
          `Express Step Function '${name}' has no logging. Express workflows have no execution history - without CloudWatch logging, DR failures are completely invisible.`,
          { type, level: loggingLevel(node) },
          'Enable CloudWatch Logs for the Express workflow.',
        )
      : createResult(
          sfnExpressNoLoggingRule.id,
          node,
          'pass',
          `Express Step Function '${name}' has logging enabled.`,
          { type, level: loggingLevel(node) },
        );
  },
};

export const stepFunctionsValidationRules: readonly ValidationRule[] = [
  sfnTaskNoTimeoutRule,
  sfnTaskNoRetryRule,
  sfnTaskNoCatchRule,
  sfnLoggingDisabledRule,
  sfnExpressNoLoggingRule,
];
