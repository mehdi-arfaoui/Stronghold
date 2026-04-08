import { describe, expect, it } from 'vitest';

import type { ContextualFinding, InfraNode, Service } from '../../index.js';
import { annotatePolicyViolations, evaluatePolicies } from '../policy-engine.js';
import type { DRPolicy } from '../policy-types.js';

describe('evaluatePolicies', () => {
  it('matches resources by service criticality and role', () => {
    const violations = evaluatePolicies(
      [
        createPolicy({
          appliesTo: {
            serviceCriticality: 'critical',
            resourceRole: 'datastore',
          },
        }),
      ],
      [createFinding()],
      [createService()],
      [createNode()],
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.policyId).toBe('pol-001');
  });

  it('matches resources by tag', () => {
    const violations = evaluatePolicies(
      [
        createPolicy({
          appliesTo: {
            tag: { key: 'env', value: 'production' },
          },
        }),
      ],
      [createFinding()],
      [createService()],
      [createNode({ tags: { env: 'production' } })],
    );

    expect(violations).toHaveLength(1);
  });

  it('does not create a violation when the failing finding is out of scope', () => {
    const violations = evaluatePolicies(
      [
        createPolicy({
          appliesTo: {
            serviceCriticality: 'high',
          },
        }),
      ],
      [createFinding()],
      [createService()],
      [createNode()],
    );

    expect(violations).toEqual([]);
  });

  it('does not create a violation when the rule does not apply to the resource type', () => {
    const violations = evaluatePolicies(
      [
        createPolicy({
          rule: 'route53_failover_configured',
        }),
      ],
      [createFinding()],
      [createService()],
      [createNode()],
    );

    expect(violations).toEqual([]);
  });

  it('annotates findings with every matching policy violation', () => {
    const finding = createFinding();
    const violations = evaluatePolicies(
      [
        createPolicy({ id: 'pol-001', name: 'Policy One' }),
        createPolicy({ id: 'pol-002', name: 'Policy Two' }),
      ],
      [finding],
      [createService()],
      [createNode()],
    );

    const annotated = annotatePolicyViolations([finding], violations);

    expect(annotated[0]?.policyViolations?.map((violation) => violation.policyId)).toEqual([
      'pol-001',
      'pol-002',
    ]);
  });
});

function createPolicy(overrides: Partial<DRPolicy> = {}): DRPolicy {
  return {
    id: 'pol-001',
    name: 'Critical services must have backup',
    description: 'Critical datastores must pass backup_plan_exists',
    rule: 'backup_plan_exists',
    appliesTo: {
      serviceCriticality: 'critical',
      resourceRole: 'datastore',
    },
    severity: 'critical',
    ...overrides,
  };
}

function createFinding(overrides: Partial<ContextualFinding> = {}): ContextualFinding {
  return {
    ruleId: 'backup_plan_exists',
    nodeId: 'payment-db',
    nodeName: 'payment-db',
    severity: 'high',
    category: 'backup',
    passed: false,
    serviceId: 'payment',
    serviceName: 'Payment',
    resourceRole: 'datastore',
    technicalImpact: {
      observation: 'Missing backup plan',
      metadataKey: 'backupPlan',
      metadataValue: false,
      expectedValue: 'configured',
    },
    drImpact: {
      summary: 'Data recovery is not possible.',
      recoveryImplication: 'Restore requires a backup that does not exist.',
      affectedCapability: 'backup',
    },
    scenarioImpact: null,
    remediation: null,
    ...overrides,
  };
}

function createService(): Service {
  return {
    id: 'payment',
    name: 'Payment',
    criticality: 'critical',
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1.0,
    },
    resources: [
      {
        nodeId: 'payment-db',
        role: 'datastore',
        detectionSource: {
          type: 'manual',
          file: '.stronghold/services.yml',
          confidence: 1.0,
        },
      },
    ],
    metadata: {},
  };
}

function createNode(
  overrides: Partial<InfraNode> = {},
): InfraNode {
  return {
    id: 'payment-db',
    name: 'payment-db',
    type: 'DATABASE',
    provider: 'aws',
    region: 'eu-west-1',
    availabilityZone: null,
    tags: {},
    metadata: {
      sourceType: 'rds',
      criticality: 'critical',
    },
    ...overrides,
  };
}
