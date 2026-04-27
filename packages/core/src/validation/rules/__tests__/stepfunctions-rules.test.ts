import { describe, expect, it } from 'vitest';
import type { InfraNodeAttrs } from '../../../types/infrastructure.js';
import { runValidation } from '../../validation-engine.js';
import type { ValidationEdge, WeightedValidationResult } from '../../validation-types.js';
import { stepFunctionsValidationRules } from '../stepfunctions-rules.js';

const STATE_MACHINE_ARN = 'arn:aws:states:eu-west-3:123456789012:stateMachine:order-flow';
const LAMBDA_ARN = 'arn:aws:lambda:eu-west-3:123456789012:function:ship-order';

function createNode(metadata: Record<string, unknown> = {}): InfraNodeAttrs {
  return {
    id: STATE_MACHINE_ARN,
    name: 'order-flow',
    type: 'SERVERLESS',
    provider: 'aws',
    region: 'eu-west-3',
    availabilityZone: null,
    tags: {},
    metadata: {
      sourceType: 'SFN_STATE_MACHINE',
      stateMachineArn: STATE_MACHINE_ARN,
      stateMachineName: 'order-flow',
      type: 'STANDARD',
      loggingConfiguration: {
        level: 'ERROR',
        includeExecutionData: false,
        destinations: [],
      },
      parsedDefinition: {
        totalStates: 1,
        waitStates: 0,
        parallelStates: 0,
        hasTimeout: true,
        taskStates: [
          {
            name: 'InvokeLambda',
            resource: LAMBDA_ARN,
            service: 'Lambda',
            timeoutSeconds: 30,
            heartbeatSeconds: null,
            retry: [{ errorEquals: ['States.ALL'], intervalSeconds: 1, maxAttempts: 3, backoffRate: 2 }],
            catch: [{ errorEquals: ['States.ALL'], next: 'Fallback' }],
            next: 'Done',
            end: false,
            isTerminal: false,
          },
        ],
      },
      ...metadata,
    },
  };
}

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'InvokeLambda',
    resource: LAMBDA_ARN,
    service: 'Lambda',
    timeoutSeconds: 30,
    heartbeatSeconds: null,
    retry: [{ errorEquals: ['States.ALL'], intervalSeconds: 1, maxAttempts: 3, backoffRate: 2 }],
    catch: [{ errorEquals: ['States.ALL'], next: 'Fallback' }],
    next: 'Done',
    end: false,
    isTerminal: false,
    ...overrides,
  };
}

function withTasks(tasks: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    parsedDefinition: {
      totalStates: tasks.length,
      waitStates: 0,
      parallelStates: 0,
      hasTimeout: tasks.some((entry) => entry.timeoutSeconds !== null),
      taskStates: tasks,
    },
  };
}

function executeRule(
  ruleId: string,
  nodes: readonly InfraNodeAttrs[],
  edges: readonly ValidationEdge[] = [],
): WeightedValidationResult {
  const report = runValidation(nodes, edges, stepFunctionsValidationRules);
  const result = report.results.find(
    (entry) => entry.ruleId === ruleId && entry.nodeId === STATE_MACHINE_ARN,
  );
  if (!result) throw new Error(`Missing result for ${ruleId}`);
  return result;
}

describe('StepFunctions DR Rules', () => {
  it('flags task state without timeout', () => {
    const result = executeRule('SFN_TASK_NO_TIMEOUT', [
      createNode(withTasks([task({ timeoutSeconds: null, heartbeatSeconds: null })])),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('high');
  });

  it('passes task state with timeout', () => {
    const result = executeRule('SFN_TASK_NO_TIMEOUT', [createNode()]);

    expect(result.status).toBe('pass');
  });

  it('flags task state invoking Lambda without retry', () => {
    const result = executeRule('SFN_TASK_NO_RETRY', [
      createNode(withTasks([task({ retry: null })])),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('medium');
  });

  it('passes task state with retry configured', () => {
    const result = executeRule('SFN_TASK_NO_RETRY', [createNode()]);

    expect(result.status).toBe('pass');
  });

  it('flags task state without catch', () => {
    const result = executeRule('SFN_TASK_NO_CATCH', [
      createNode(withTasks([task({ catch: null, next: 'Done', isTerminal: false })])),
    ]);

    expect(result.status).toBe('fail');
  });

  it('flags Express workflow without logging as high', () => {
    const result = executeRule('SFN_EXPRESS_NO_LOGGING', [
      createNode({ type: 'EXPRESS', loggingConfiguration: null }),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('high');
  });

  it('flags Standard workflow without logging as low', () => {
    const result = executeRule('SFN_LOGGING_DISABLED', [
      createNode({ type: 'STANDARD', loggingConfiguration: null }),
    ]);

    expect(result.status).toBe('fail');
    expect(result.severity).toBe('low');
  });
});
