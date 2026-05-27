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

function clusterName(node: InfraNode): string {
  const metadata = getMetadata(node);
  return readString(metadata.dbClusterIdentifier) ?? readString(metadata.clusterIdentifier) ?? node.name;
}

function isServerlessV1(node: InfraNode): boolean {
  return readString(getMetadata(node).serverlessVersion) === 'v1';
}

function scalingConfigurationV1(node: InfraNode): Record<string, unknown> | null {
  return readObject(getMetadata(node).scalingConfigurationV1);
}

const auroraServerlessV1AutoPauseRule: ValidationRule = {
  id: 'AURORA_SERVERLESS_V1_AUTOPAUSE',
  name: 'Aurora Serverless v1 Auto Pause',
  description: 'Checks whether Aurora Serverless v1 can cold-start during a DR event.',
  category: 'recovery',
  severity: 'high',
  appliesToTypes: ['aurora-cluster'],
  observedKeys: ['serverlessVersion', 'scalingConfigurationV1.autoPause'],
  validate: (node) => {
    if (!isServerlessV1(node)) {
      return createResult(
        auroraServerlessV1AutoPauseRule.id,
        node,
        'pass',
        `Aurora cluster '${clusterName(node)}' is not Serverless v1.`,
      );
    }

    const scaling = scalingConfigurationV1(node);
    const autoPause = readBoolean(scaling?.autoPause);
    return autoPause === true
      ? createResult(
          auroraServerlessV1AutoPauseRule.id,
          node,
          'fail',
          `Aurora Serverless v1 cluster '${clusterName(node)}' has auto-pause enabled. After pausing, the cluster takes 25-60 seconds to resume. During a DR event, this cold start delay can cause cascading timeouts in dependent services.`,
          { autoPause },
          'Disable auto-pause or ensure dependent service timeouts tolerate the resume delay.',
        )
      : createResult(
          auroraServerlessV1AutoPauseRule.id,
          node,
          'pass',
          `Aurora Serverless v1 cluster '${clusterName(node)}' does not auto-pause.`,
          { autoPause },
        );
  },
};

const auroraServerlessV1DeprecatedRule: ValidationRule = {
  id: 'AURORA_SERVERLESS_V1_DEPRECATED',
  name: 'Aurora Serverless v1 Deprecated',
  description: 'Checks whether the Aurora cluster uses deprecated Serverless v1 engine mode.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['aurora-cluster'],
  observedKeys: ['serverlessVersion', 'engineMode'],
  validate: (node) =>
    isServerlessV1(node)
      ? createResult(
          auroraServerlessV1DeprecatedRule.id,
          node,
          'fail',
          `Aurora Serverless v1 cluster '${clusterName(node)}' uses the deprecated Serverless v1 engine mode. AWS recommends migrating to Aurora Serverless v2 for improved scaling and availability. v1 has limited instance types, no multi-AZ reader support, and longer scaling times.`,
          { serverlessVersion: 'v1' },
          'Plan migration to Aurora Serverless v2 or provisioned Aurora with tested failover.',
        )
      : createResult(
          auroraServerlessV1DeprecatedRule.id,
          node,
          'pass',
          `Aurora cluster '${clusterName(node)}' does not use Serverless v1.`,
        ),
};

const auroraServerlessV1LowMaxCapacityRule: ValidationRule = {
  id: 'AURORA_SERVERLESS_V1_LOW_MAX_CAPACITY',
  name: 'Aurora Serverless v1 Max Capacity',
  description: 'Checks whether Aurora Serverless v1 max ACU can absorb post-DR traffic surge.',
  category: 'recovery',
  severity: 'medium',
  appliesToTypes: ['aurora-cluster'],
  observedKeys: ['serverlessVersion', 'scalingConfigurationV1.maxCapacity'],
  validate: (node) => {
    if (!isServerlessV1(node)) {
      return createResult(
        auroraServerlessV1LowMaxCapacityRule.id,
        node,
        'pass',
        `Aurora cluster '${clusterName(node)}' is not Serverless v1.`,
      );
    }

    const maxCapacity = readNumber(scalingConfigurationV1(node)?.maxCapacity);
    if (maxCapacity === null) {
      return createResult(
        auroraServerlessV1LowMaxCapacityRule.id,
        node,
        'skip',
        `Aurora Serverless v1 cluster '${clusterName(node)}' has no scaling configuration visible in this scan.`,
      );
    }

    return maxCapacity < 16
      ? createResult(
          auroraServerlessV1LowMaxCapacityRule.id,
          node,
          'fail',
          `Aurora Serverless v1 cluster '${clusterName(node)}' has max capacity ${maxCapacity} ACU. During a traffic surge post-DR recovery, the cluster may not scale sufficiently.`,
          { maxCapacity },
          'Set Serverless v1 max capacity to at least 16 ACU for production recovery paths.',
        )
      : createResult(
          auroraServerlessV1LowMaxCapacityRule.id,
          node,
          'pass',
          `Aurora Serverless v1 cluster '${clusterName(node)}' has sufficient max capacity.`,
          { maxCapacity },
        );
  },
};

export const auroraValidationRules: readonly ValidationRule[] = [
  auroraServerlessV1AutoPauseRule,
  auroraServerlessV1DeprecatedRule,
  auroraServerlessV1LowMaxCapacityRule,
];
