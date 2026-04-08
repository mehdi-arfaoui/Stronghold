import { describe, expect, it } from 'vitest';

import { analyzeCoverage } from '../coverage-analyzer.js';
import type { Scenario } from '../scenario-types.js';
import type { DRPlan } from '../../drp/drp-types.js';
import type { DRPRunbook } from '../../drp/runbook/runbook-types.js';
import type { Evidence } from '../../evidence/evidence-types.js';
import type { Service } from '../../services/service-types.js';
import type { InfraNodeAttrs } from '../../types/infrastructure.js';

type ResourceRoleSpec = NonNullable<Service['resources'][number]['role']>;
type ResourceSpec = readonly [string, ResourceRoleSpec];

describe('analyzeCoverage', () => {
  it('marks a covered service when tested evidence exists', () => {
    const service = createService('payment', 'Payment', [
      ['payment-api', 'compute'],
      ['payment-db', 'datastore'],
    ]);
    const nodes = [
      createNode('payment-api', 'VM', 'eu-west-3a'),
      createNode('payment-db', 'DATABASE', 'eu-west-3b'),
    ];

    const coverage = analyzeCoverage(
      createScenario('az-failure', 'az_failure', 'payment', ['payment-db']),
      createPlan([
        createComponent('payment-api', 'auto_scaling', 'VM'),
        createComponent('payment-db', 'failover'),
      ]),
      [createEvidence('tested', 'payment-db', 'payment')],
      [service],
      nodes,
      createNeutralRunbook(),
    );

    expect(coverage.verdict).toBe('covered');
    expect(coverage.details[0]).toMatchObject({
      serviceId: 'payment',
      verdict: 'covered',
      evidenceLevel: 'tested',
    });
  });

  it('marks a service as partially covered with only observed evidence', () => {
    const coverage = analyzeCoverage(
      createScenario('payment-spof', 'node_failure', 'payment', ['payment-db']),
      createPlan([createComponent('payment-db', 'rebuild')]),
      [createEvidence('observed', 'payment-db', 'payment')],
      [createService('payment', 'Payment', [['payment-db', 'datastore']])],
      [createNode('payment-db', 'DATABASE', 'eu-west-3a')],
      createNeutralRunbook(),
    );

    expect(coverage.verdict).toBe('partially_covered');
    expect(coverage.details[0]?.reason).toContain('has not been tested');
  });

  it('marks a service as partially covered when the last test is expired', () => {
    const coverage = analyzeCoverage(
      createScenario('payment-spof', 'node_failure', 'payment', ['payment-db']),
      createPlan([createComponent('payment-db', 'rebuild')]),
      [createEvidence('expired', 'payment-db', 'payment')],
      [createService('payment', 'Payment', [['payment-db', 'datastore']])],
      [createNode('payment-db', 'DATABASE', 'eu-west-3a')],
      createNeutralRunbook(),
    );

    expect(coverage.verdict).toBe('partially_covered');
    expect(coverage.details[0]?.reason).toContain('expired');
  });

  it('marks a service as uncovered when it is missing from the DRP', () => {
    const coverage = analyzeCoverage(
      createScenario('payment-spof', 'node_failure', 'payment', ['payment-db']),
      createPlan([createComponent('other-db', 'rebuild')]),
      [],
      [createService('payment', 'Payment', [['payment-db', 'datastore']])],
      [createNode('payment-db', 'DATABASE', 'eu-west-3a')],
      createNeutralRunbook(),
    );

    expect(coverage.verdict).toBe('uncovered');
    expect(coverage.details[0]?.reason).toContain('Service not covered in DRP');
  });

  it('marks coverage as degraded when the runbook references deleted resources', () => {
    const coverage = analyzeCoverage(
      createScenario('payment-spof', 'node_failure', 'payment', ['payment-db']),
      createPlan([createComponent('payment-db', 'rebuild')]),
      [],
      [createService('payment', 'Payment', [['payment-db', 'datastore']])],
      [],
      createRunbook(),
    );

    expect(coverage.verdict).toBe('degraded');
    expect(coverage.details[0]?.reason).toContain('stale resources');
  });

  it('returns a helpful uncovered message when no DRP exists', () => {
    const coverage = analyzeCoverage(
      createScenario('payment-spof', 'node_failure', 'payment', ['payment-db']),
      null,
      [],
      [createService('payment', 'Payment', [['payment-db', 'datastore']])],
      [createNode('payment-db', 'DATABASE', 'eu-west-3a')],
    );

    expect(coverage.verdict).toBe('uncovered');
    expect(coverage.details[0]?.reason).toContain("No DRP generated");
  });

  it('recognizes an AZ recovery path when the service keeps critical capacity in another AZ', () => {
    const coverage = analyzeCoverage(
      createScenario('az-failure', 'az_failure', 'payment', ['payment-db-a']),
      createPlan([createComponent('payment-db-a', 'failover'), createComponent('payment-db-b', 'failover')]),
      [],
      [
        createService('payment', 'Payment', [
          ['payment-db-a', 'datastore'],
          ['payment-db-b', 'datastore'],
        ]),
      ],
      [
        createNode('payment-db-a', 'DATABASE', 'eu-west-3a'),
        createNode('payment-db-b', 'DATABASE', 'eu-west-3b'),
      ],
      createNeutralRunbook(),
    );

    expect(coverage.details[0]?.reason).toContain('has not been tested');
  });

  it('marks single-AZ services as uncovered for AZ failure scenarios', () => {
    const coverage = analyzeCoverage(
      createScenario('az-failure', 'az_failure', 'payment', ['payment-db']),
      createPlan([createComponent('payment-db', 'failover')]),
      [],
      [createService('payment', 'Payment', [['payment-db', 'datastore']])],
      [createNode('payment-db', 'DATABASE', 'eu-west-3a')],
      createNeutralRunbook(),
    );

    expect(coverage.verdict).toBe('uncovered');
    expect(coverage.details[0]?.missingCapabilities).toContain(
      'Deploy critical resources in another availability zone.',
    );
  });

  it('recognizes restore coverage for data corruption when backups exist', () => {
    const coverage = analyzeCoverage(
      createScenario('data-corruption', 'data_corruption', 'payment', ['payment-db']),
      createPlan([createComponent('payment-db', 'restore_from_backup')]),
      [],
      [createService('payment', 'Payment', [['payment-db', 'datastore']])],
      [createNode('payment-db', 'DATABASE', 'eu-west-3a')],
      createNeutralRunbook(),
    );

    expect(coverage.verdict).toBe('partially_covered');
    expect(coverage.details[0]?.recoveryPath).toContain('Restore');
  });

  it('marks data corruption as uncovered without a restore path', () => {
    const coverage = analyzeCoverage(
      createScenario('data-corruption', 'data_corruption', 'payment', ['payment-db']),
      createPlan([createComponent('payment-db', 'failover')]),
      [],
      [createService('payment', 'Payment', [['payment-db', 'datastore']])],
      [createNode('payment-db', 'DATABASE', 'eu-west-3a')],
      createNeutralRunbook(),
    );

    expect(coverage.verdict).toBe('uncovered');
    expect(coverage.details[0]?.reason).toContain('backup or PITR');
  });
});

function createScenario(
  id: string,
  type: Scenario['type'],
  serviceId: string,
  affectedNodeIds: readonly string[],
): Scenario {
  return {
    id,
    name: id,
    description: id,
    type,
    disruption: {
      affectedNodes: affectedNodeIds,
      selectionCriteria: id,
    },
    impact: {
      directlyAffected: affectedNodeIds.map((nodeId) => ({
        nodeId,
        nodeName: nodeId,
        serviceId,
        reason: 'direct',
        impactType: 'direct' as const,
        cascadeDepth: 0,
      })),
      cascadeAffected: [],
      totalAffectedNodes: affectedNodeIds.length,
      totalAffectedServices: [serviceId],
      serviceImpact: [
        {
          serviceId,
          serviceName: serviceId,
          affectedResources: affectedNodeIds.length,
          totalResources: affectedNodeIds.length,
          percentageAffected: 100,
          criticalResourcesAffected: affectedNodeIds,
          status: 'down',
        },
      ],
    },
  };
}

function createPlan(
  components: readonly DRPlan['services'][number]['components'][number][],
): DRPlan {
  return {
    id: 'drp-1',
    version: '1.0.0',
    generated: '2026-04-08T00:00:00.000Z',
    infrastructureHash: 'hash',
    provider: 'aws',
    regions: ['eu-west-3'],
    services: [
      {
        name: 'payment',
        criticality: 'high',
        rtoTarget: '1h',
        rpoTarget: '15m',
        components,
        validationTests: [],
        estimatedRTO: '1h',
        estimatedRPO: '15m',
        recoveryOrder: components.map((component) => component.resourceId),
      },
    ],
    metadata: {
      totalResources: components.length,
      coveredResources: components.length,
      uncoveredResources: [],
      worstCaseRTO: '1h',
      averageRPO: '15m',
      stale: false,
    },
  };
}

function createComponent(
  resourceId: string,
  recoveryStrategy: DRPlan['services'][number]['components'][number]['recoveryStrategy'],
  resourceType = 'DATABASE',
): DRPlan['services'][number]['components'][number] {
  return {
    resourceId,
    resourceType,
    name: resourceId,
    region: 'eu-west-3',
    recoveryStrategy,
    recoverySteps: [],
    estimatedRTO: '1h',
    estimatedRPO: '15m',
    dependencies: [],
    risks: [],
  };
}

function createService(
  id: string,
  name: string,
  resources: ReadonlyArray<ResourceSpec>,
): Service {
  return {
    id,
    name,
    criticality: 'high',
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1.0,
    },
    resources: resources.map(([nodeId, role]) => ({
      nodeId,
      role,
      detectionSource: {
        type: 'manual',
        file: '.stronghold/services.yml',
        confidence: 1.0,
      },
    })),
    metadata: {},
  };
}

function createNode(id: string, type: string, availabilityZone: string): InfraNodeAttrs {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region: 'eu-west-3',
    availabilityZone,
    tags: {},
    metadata: {},
  };
}

function createNeutralRunbook(): DRPRunbook {
  return {
    drpPlanId: 'drp-1',
    generatedAt: '2026-04-08T00:00:00.000Z',
    disclaimer: 'test',
    confidentialityWarning: 'test',
    componentRunbooks: [],
  };
}

function createEvidence(
  type: Evidence['type'],
  nodeId: string,
  serviceId: string,
): Evidence {
  return {
    id: `${type}-${nodeId}`,
    type,
    source:
      type === 'tested' || type === 'expired'
        ? {
            origin: 'test',
            testType: 'recovery-drill',
            testDate: '2026-03-15T00:00:00.000Z',
          }
        : {
            origin: 'scan',
            scanTimestamp: '2026-04-08T00:00:00.000Z',
          },
    subject: {
      nodeId,
      serviceId,
    },
    observation: {
      key: 'backup',
      value: true,
      description: 'evidence',
    },
    timestamp: '2026-03-15T00:00:00.000Z',
  };
}

function createRunbook(): DRPRunbook {
  return {
    drpPlanId: 'drp-1',
    generatedAt: '2026-04-08T00:00:00.000Z',
    disclaimer: 'test',
    confidentialityWarning: 'test',
    componentRunbooks: [
      {
        componentId: 'payment-db',
        componentName: 'payment-db',
        componentType: 'DATABASE',
        strategy: 'backup_restore',
        prerequisites: [],
        steps: [
          {
            order: 1,
            title: 'restore',
            description: 'Restore database',
            command: {
              type: 'aws_cli',
              command: 'aws rds reboot-db-instance --db-instance-identifier payment-db',
              description: 'Restore payment-db',
            },
            estimatedMinutes: 5,
            verification: null,
            requiresApproval: false,
            notes: [],
          },
        ],
        rollback: {
          description: 'rollback',
          steps: [],
        },
        finalValidation: null,
        warnings: [],
      },
    ],
  };
}
