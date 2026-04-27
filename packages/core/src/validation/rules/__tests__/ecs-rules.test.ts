import { describe, expect, it } from 'vitest';
import { EdgeType, type InfraNodeAttrs } from '../../../types/infrastructure.js';
import { runValidation } from '../../validation-engine.js';
import type { ValidationEdge, WeightedValidationResult } from '../../validation-types.js';
import { ecsValidationRules } from '../ecs-rules.js';

const SERVICE_ARN = 'arn:aws:ecs:eu-west-3:123456789012:service/prod/api';
const TASK_DEFINITION_ARN = 'arn:aws:ecs:eu-west-3:123456789012:task-definition/api:42';
const SECRET_ARN = 'arn:aws:secretsmanager:eu-west-3:123456789012:secret:db-AbCdEf';
const MISSING_SECRET_ARN = 'arn:aws:ssm:eu-west-3:123456789012:parameter/api/missing';

function createNode(
  overrides: Partial<InfraNodeAttrs> & {
    readonly id: string;
    readonly metadata: Record<string, unknown>;
  },
): InfraNodeAttrs {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    type: overrides.type ?? 'CONTAINER',
    provider: 'aws',
    region: overrides.region ?? 'eu-west-3',
    availabilityZone: overrides.availabilityZone ?? null,
    tags: {},
    metadata: overrides.metadata,
    ...overrides,
  };
}

function createEdge(source: string, target: string, type: string): ValidationEdge {
  return { source, target, type };
}

function createServiceNode(metadata: Record<string, unknown> = {}): InfraNodeAttrs {
  return createNode({
    id: SERVICE_ARN,
    name: 'api',
    metadata: {
      sourceType: 'ECS_SERVICE',
      serviceArn: SERVICE_ARN,
      serviceName: 'api',
      clusterArn: 'arn:aws:ecs:eu-west-3:123456789012:cluster/prod',
      desiredCount: 3,
      runningCount: 3,
      deploymentConfiguration: {
        deploymentCircuitBreaker: { enable: true, rollback: true },
      },
      capacityProviderStrategy: [
        { capacityProvider: 'FARGATE', weight: 3 },
        { capacityProvider: 'FARGATE_SPOT', weight: 1 },
      ],
      ...metadata,
    },
  });
}

function createTaskNode(id: string, availabilityZone: string): InfraNodeAttrs {
  return createNode({
    id,
    name: id.split('/').pop() ?? id,
    availabilityZone,
    metadata: {
      sourceType: 'ECS_TASK',
      serviceArn: SERVICE_ARN,
      serviceName: 'api',
      clusterArn: 'arn:aws:ecs:eu-west-3:123456789012:cluster/prod',
      availabilityZone,
    },
  });
}

function createTaskDefinitionNode(metadata: Record<string, unknown> = {}): InfraNodeAttrs {
  return createNode({
    id: TASK_DEFINITION_ARN,
    name: 'api:42',
    metadata: {
      sourceType: 'ECS_TASK_DEFINITION',
      family: 'api',
      revision: 42,
      executionRoleArn: 'arn:aws:iam::123456789012:role/ecsTaskExecutionRole',
      secretReferences: [],
      ...metadata,
    },
  });
}

function createSecretNode(id = SECRET_ARN): InfraNodeAttrs {
  return createNode({
    id,
    name: 'secret',
    type: 'APPLICATION',
    metadata: {
      sourceType: 'SECRETS_MANAGER_SECRET',
      arn: id,
    },
  });
}

function executeRule(
  ruleId: string,
  targetNodeId: string,
  nodes: readonly InfraNodeAttrs[],
  edges: readonly ValidationEdge[] = [],
): WeightedValidationResult {
  const report = runValidation(nodes, edges, ecsValidationRules);
  const result = report.results.find(
    (entry) => entry.ruleId === ruleId && entry.nodeId === targetNodeId,
  );
  if (!result) throw new Error(`Missing result for ${ruleId}/${targetNodeId}`);
  return result;
}

describe('ECS DR Rules', () => {
  it('flags single-AZ service as high severity', () => {
    const nodes = [
      createServiceNode(),
      createTaskNode(`${SERVICE_ARN}/task-a`, 'eu-west-3a'),
      createTaskNode(`${SERVICE_ARN}/task-b`, 'eu-west-3a'),
      createTaskNode(`${SERVICE_ARN}/task-c`, 'eu-west-3a'),
    ];
    const edges = nodes
      .filter((node) => node.id !== SERVICE_ARN)
      .map((node) => createEdge(node.id, SERVICE_ARN, EdgeType.DEPENDS_ON));

    const result = executeRule('ECS_MULTI_AZ_DEPLOYMENT', SERVICE_ARN, nodes, edges);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('high');
  });

  it('passes multi-AZ service', () => {
    const nodes = [
      createServiceNode(),
      createTaskNode(`${SERVICE_ARN}/task-a`, 'eu-west-3a'),
      createTaskNode(`${SERVICE_ARN}/task-b`, 'eu-west-3b'),
      createTaskNode(`${SERVICE_ARN}/task-c`, 'eu-west-3b'),
    ];

    expect(executeRule('ECS_MULTI_AZ_DEPLOYMENT', SERVICE_ARN, nodes).status).toBe('pass');
  });

  it('flags disabled circuit breaker as medium', () => {
    const service = createServiceNode({
      deploymentConfiguration: { deploymentCircuitBreaker: { enable: false, rollback: false } },
    });
    const result = executeRule('ECS_CIRCUIT_BREAKER_DISABLED', SERVICE_ARN, [service]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('medium');
  });

  it('flags Fargate Spot-only as high', () => {
    const service = createServiceNode({
      capacityProviderStrategy: [{ capacityProvider: 'FARGATE_SPOT', weight: 1 }],
    });
    const result = executeRule('ECS_FARGATE_SPOT_ONLY', SERVICE_ARN, [service]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('high');
  });

  it('passes mixed Fargate + Fargate Spot', () => {
    const service = createServiceNode({
      capacityProviderStrategy: [
        { capacityProvider: 'FARGATE', weight: 3 },
        { capacityProvider: 'FARGATE_SPOT', weight: 1 },
      ],
    });

    expect(executeRule('ECS_FARGATE_SPOT_ONLY', SERVICE_ARN, [service]).status).toBe('pass');
  });

  it('flags desired vs running mismatch', () => {
    const service = createServiceNode({ desiredCount: 5, runningCount: 3 });

    expect(executeRule('ECS_DESIRED_VS_RUNNING_MISMATCH', SERVICE_ARN, [service]).status).toBe(
      'fail',
    );
  });

  it('flags missing execution role as critical', () => {
    const taskDefinition = createTaskDefinitionNode({ executionRoleArn: null });
    const result = executeRule('ECS_MISSING_EXECUTION_ROLE', TASK_DEFINITION_ARN, [
      taskDefinition,
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('critical');
  });

  it('flags unresolvable secrets dependency', () => {
    const taskDefinition = createTaskDefinitionNode({
      secretReferences: [
        { name: 'DB_PASSWORD', targetArn: SECRET_ARN, valueFrom: SECRET_ARN },
        { name: 'APP_CONFIG', targetArn: MISSING_SECRET_ARN, valueFrom: MISSING_SECRET_ARN },
      ],
    });
    const result = executeRule('ECS_SECRETS_DEPENDENCY', TASK_DEFINITION_ARN, [
      taskDefinition,
      createSecretNode(),
    ]);

    expect(result.status).toBe('fail');
    expect(result.details?.missingSecrets).toEqual([MISSING_SECRET_ARN]);
  });
});
