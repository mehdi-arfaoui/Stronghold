import { describe, expect, it } from 'vitest';

import type { InfraNodeAttrs } from '../../../types/infrastructure.js';
import { runValidation } from '../../validation-engine.js';
import type { ValidationEdge, WeightedValidationResult } from '../../validation-types.js';
import { auroraValidationRules } from '../aurora-rules.js';

const CLUSTER_ARN = 'arn:aws:rds:eu-west-3:123456789012:cluster:payments';

function createClusterNode(metadata: Record<string, unknown> = {}): InfraNodeAttrs {
  return {
    id: CLUSTER_ARN,
    name: 'payments',
    type: 'DATABASE',
    provider: 'aws',
    region: 'eu-west-3',
    availabilityZone: null,
    tags: {},
    metadata: {
      sourceType: 'AURORA_CLUSTER',
      dbClusterIdentifier: 'payments',
      engineMode: 'serverless',
      serverlessVersion: 'v1',
      scalingConfigurationV1: {
        minCapacity: 2,
        maxCapacity: 32,
        autoPause: false,
        secondsUntilAutoPause: 300,
      },
      ...metadata,
    },
  };
}

function executeRule(
  ruleId: string,
  nodes: readonly InfraNodeAttrs[],
  edges: readonly ValidationEdge[] = [],
): WeightedValidationResult {
  const report = runValidation(nodes, edges, auroraValidationRules);
  const result = report.results.find(
    (entry) => entry.ruleId === ruleId && entry.nodeId === CLUSTER_ARN,
  );
  if (!result) throw new Error(`Missing result for ${ruleId}`);
  return result;
}

describe('Aurora v1 DR Rules', () => {
  it('flags v1 auto-pause as high severity', () => {
    const result = executeRule('AURORA_SERVERLESS_V1_AUTOPAUSE', [
      createClusterNode({
        scalingConfigurationV1: {
          minCapacity: 2,
          maxCapacity: 32,
          autoPause: true,
          secondsUntilAutoPause: 600,
        },
      }),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('high');
  });

  it('passes v1 without auto-pause', () => {
    const result = executeRule('AURORA_SERVERLESS_V1_AUTOPAUSE', [createClusterNode()]);

    expect(result.status).toBe('pass');
  });

  it('flags v1 as deprecated', () => {
    const result = executeRule('AURORA_SERVERLESS_V1_DEPRECATED', [createClusterNode()]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('medium');
  });

  it('does not flag v2 or provisioned as deprecated', () => {
    const v2 = executeRule('AURORA_SERVERLESS_V1_DEPRECATED', [
      createClusterNode({
        engineMode: 'provisioned',
        serverlessVersion: 'v2',
        scalingConfigurationV1: null,
      }),
    ]);
    const provisioned = executeRule('AURORA_SERVERLESS_V1_DEPRECATED', [
      createClusterNode({
        engineMode: 'provisioned',
        serverlessVersion: null,
        scalingConfigurationV1: null,
      }),
    ]);

    expect(v2.status).toBe('pass');
    expect(provisioned.status).toBe('pass');
  });

  it('flags v1 low max capacity', () => {
    const result = executeRule('AURORA_SERVERLESS_V1_LOW_MAX_CAPACITY', [
      createClusterNode({
        scalingConfigurationV1: {
          minCapacity: 1,
          maxCapacity: 4,
          autoPause: false,
          secondsUntilAutoPause: 300,
        },
      }),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('medium');
  });

  it('passes v1 with sufficient max capacity', () => {
    const result = executeRule('AURORA_SERVERLESS_V1_LOW_MAX_CAPACITY', [
      createClusterNode({
        scalingConfigurationV1: {
          minCapacity: 2,
          maxCapacity: 64,
          autoPause: false,
          secondsUntilAutoPause: 300,
        },
      }),
    ]);

    expect(result.status).toBe('pass');
  });
});
