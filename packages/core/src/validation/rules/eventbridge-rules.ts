import { getMetadata, readNumber, readString } from '../../graph/analysis-helpers.js';
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

function targetArnService(targetArn: string | null): string | null {
  if (!targetArn?.startsWith('arn:')) return null;
  const segments = targetArn.split(':');
  return segments[2] ?? null;
}

function isManagedDeliveryTarget(targetArn: string | null): boolean {
  const service = targetArnService(targetArn);
  return service === 'logs' || service === 'firehose';
}

const eventBridgeRuleDisabledRule: ValidationRule = {
  id: 'EVENTBRIDGE_RULE_DISABLED',
  name: 'EventBridge Rule Enabled',
  description: 'Checks whether EventBridge rules are enabled for recovery-time event delivery.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['eventbridge-rule'],
  observedKeys: ['state'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const name = readString(metadata.ruleName) ?? readString(metadata.name) ?? node.name;
    const bus = readString(metadata.eventBusName) ?? 'default';
    const state = (readString(metadata.state) ?? '').toUpperCase();

    return state === 'DISABLED'
      ? createResult(
          eventBridgeRuleDisabledRule.id,
          node,
          'fail',
          `EventBridge rule '${name}' on bus '${bus}' is disabled. Events matching this rule will not be delivered during or after DR recovery.`,
          { state, eventBusName: bus },
          'Enable the rule or remove it from the recovery path.',
        )
      : createResult(
          eventBridgeRuleDisabledRule.id,
          node,
          'pass',
          `EventBridge rule '${name}' on bus '${bus}' is enabled.`,
          { state },
        );
  },
};

const eventBridgeTargetNoDlqRule: ValidationRule = {
  id: 'EVENTBRIDGE_TARGET_NO_DLQ',
  name: 'EventBridge Target Dead Letter Queue',
  description: 'Checks whether EventBridge targets retain failed deliveries in a DLQ.',
  category: 'recovery',
  severity: 'high',
  appliesToTypes: ['eventbridge-target'],
  observedKeys: ['deadLetterConfig.arn'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const id = readString(metadata.targetId) ?? readString(metadata.id) ?? node.name;
    const rule = readString(metadata.ruleName) ?? readString(metadata.ruleArn) ?? 'unknown rule';
    const targetArn = readString(metadata.targetArn);
    const deadLetterConfig = readObject(metadata.deadLetterConfig);

    if (isManagedDeliveryTarget(targetArn)) {
      return createResult(
        eventBridgeTargetNoDlqRule.id,
        node,
        'skip',
        `EventBridge target '${id}' on rule '${rule}' is a managed delivery target.`,
        { targetArn },
      );
    }

    return readString(deadLetterConfig?.arn) !== null
      ? createResult(
          eventBridgeTargetNoDlqRule.id,
          node,
          'pass',
          `EventBridge target '${id}' on rule '${rule}' has a dead letter queue.`,
        )
      : createResult(
          eventBridgeTargetNoDlqRule.id,
          node,
          'fail',
          `EventBridge target '${id}' on rule '${rule}' has no dead letter queue. Failed event deliveries during DR will be silently lost.`,
          { targetArn },
          'Configure a target-level dead letter queue.',
        );
  },
};

const eventBridgeTargetNoRetryRule: ValidationRule = {
  id: 'EVENTBRIDGE_TARGET_NO_RETRY',
  name: 'EventBridge Target Retry Policy',
  description: 'Checks whether EventBridge targets retry transient delivery failures.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['eventbridge-target'],
  observedKeys: ['retryPolicy.maximumRetryAttempts'],
  validate: (node) => {
    const metadata = getMetadata(node);
    const id = readString(metadata.targetId) ?? readString(metadata.id) ?? node.name;
    const rule = readString(metadata.ruleName) ?? readString(metadata.ruleArn) ?? 'unknown rule';
    const retryPolicy = readObject(metadata.retryPolicy);
    const maximumRetryAttempts = readNumber(retryPolicy?.maximumRetryAttempts);

    return retryPolicy !== null && maximumRetryAttempts !== 0
      ? createResult(
          eventBridgeTargetNoRetryRule.id,
          node,
          'pass',
          `EventBridge target '${id}' on rule '${rule}' has a retry policy.`,
          { maximumRetryAttempts },
        )
      : createResult(
          eventBridgeTargetNoRetryRule.id,
          node,
          'fail',
          `EventBridge target '${id}' on rule '${rule}' has no retry policy. Transient failures during DR recovery will not be retried.`,
          { maximumRetryAttempts: maximumRetryAttempts ?? null },
          'Configure target retry attempts and event age.',
        );
  },
};

export const eventBridgeValidationRules: readonly ValidationRule[] = [
  eventBridgeRuleDisabledRule,
  eventBridgeTargetNoDlqRule,
  eventBridgeTargetNoRetryRule,
];
