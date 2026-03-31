import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';
import type { GraphAnalysisReport } from '../types/analysis.js';
import { EdgeType, NodeType, type InfraNodeAttrs } from '../types/index.js';
import {
  estimateRecovery,
  estimateRPO,
  estimateRTO,
  generateDRPlan,
  type RTOEstimateInput,
} from './index.js';

type TestGraph = DirectedGraph<Record<string, unknown>, Record<string, unknown>>;

interface TestEdge {
  readonly source: string;
  readonly target: string;
  readonly type: string;
}

const FIXED_TIMESTAMP = new Date('2026-03-27T09:00:00.000Z');
const VALID_SOURCE_TYPES = new Set([
  'aws_documentation',
  'aws_sla',
  'observed',
  'configuration',
  'heuristic',
]);

function createEstimateInput(
  strategy: RTOEstimateInput['strategy'],
  metadata: Record<string, unknown> = {},
  serviceType = 'aws_rds_instance',
  isMultiRegion = false,
): RTOEstimateInput {
  return {
    strategy,
    serviceType,
    metadata,
    isMultiRegion,
  };
}

function createRdsNode(
  id: string,
  metadata: Record<string, unknown> = {},
  service = 'orders',
): InfraNodeAttrs {
  return {
    id,
    name: id,
    type: NodeType.DATABASE,
    provider: 'aws',
    region: 'eu-west-1',
    tags: { Service: service },
    metadata: {
      sourceType: 'aws_rds_instance',
      dbIdentifier: id,
      backupRetentionPeriod: 7,
      ...metadata,
    },
    criticalityScore: 80,
  };
}

function createGraph(
  nodes: readonly InfraNodeAttrs[],
  edges: readonly TestEdge[] = [],
): TestGraph {
  const graph = new DirectedGraph<Record<string, unknown>, Record<string, unknown>>();

  for (const node of nodes) {
    graph.addNode(node.id, node as unknown as Record<string, unknown>);
  }

  for (const edge of edges) {
    graph.addEdgeWithKey(`${edge.source}->${edge.target}:${edge.type}`, edge.source, edge.target, {
      type: edge.type,
      confidence: 1,
      confirmed: true,
    });
  }

  return graph;
}

function createAnalysis(graph: TestGraph): GraphAnalysisReport {
  return {
    timestamp: FIXED_TIMESTAMP,
    totalNodes: graph.order,
    totalEdges: graph.size,
    spofs: [],
    criticalityScores: new Map<string, number>(),
    redundancyIssues: [],
    regionalRisks: [],
    circularDeps: [],
    cascadeChains: [],
    resilienceScore: 75,
  };
}

function createPlan(
  nodes: readonly InfraNodeAttrs[],
  edges: readonly TestEdge[] = [],
) {
  const graph = createGraph(nodes, edges);
  return generateDRPlan({
    graph,
    analysis: createAnalysis(graph),
    provider: 'aws',
    generatedAt: FIXED_TIMESTAMP,
  });
}

describe('estimateRecovery', () => {
  it('returns the documented hot standby range', () => {
    const estimate = estimateRecovery(
      createEstimateInput('hot_standby', { multiAZ: true }),
    );

    expect(estimate.rtoMinMinutes).toBe(1);
    expect(estimate.rtoMaxMinutes).toBeLessThanOrEqual(5);
    expect(estimate.rpoMaxMinutes).toBe(0);
    expect(estimate.confidence).toBe('documented');
  });

  it('returns the documented Aurora replica failover range', () => {
    const estimate = estimateRecovery(
      createEstimateInput('aurora_failover', { replicaCount: 1 }, 'aurora_cluster'),
    );

    expect(estimate.rtoMinMinutes).toBe(0.5);
    expect(estimate.rtoMaxMinutes).toBeLessThanOrEqual(2);
    expect(estimate.rpoMaxMinutes).toBe(0);
    expect(estimate.confidence).toBe('documented');
  });

  it('returns the documented Aurora global database failover range', () => {
    const estimate = estimateRecovery(
      createEstimateInput(
        'aurora_global_failover',
        { globalClusterIdentifier: 'global-cluster-1' },
        'aurora_cluster',
        true,
      ),
    );

    expect(estimate.rtoMaxMinutes).toBeLessThanOrEqual(5);
    expect(estimate.rpoMaxMinutes).toBeLessThanOrEqual(1);
    expect(estimate.confidence).toBe('documented');
  });

  it('returns an informed warm standby estimate', () => {
    const estimate = estimateRecovery(
      createEstimateInput('warm_standby', { readReplicaDBInstanceIdentifiers: ['replica-1'] }),
    );

    expect(estimate.rtoMinMinutes).not.toBeNull();
    expect(estimate.rtoMaxMinutes).not.toBeNull();
    expect(estimate.confidence).toBe('informed');
  });

  it('uses replica lag when it is available for warm standby RPO', () => {
    const estimate = estimateRecovery(
      createEstimateInput('warm_standby', {
        readReplicaDBInstanceIdentifiers: ['replica-1'],
        replicaLag: 2,
      }),
    );

    expect(estimate.rpoMaxMinutes).toBe(2);
  });

  it('returns null RTO values for backup restore', () => {
    const estimate = estimateRecovery(
      createEstimateInput('backup_restore', {
        allocatedStorage: 200,
        storageType: 'gp3',
        backupRetentionPeriod: 7,
      }),
    );

    expect(estimate.rtoMinMinutes).toBeNull();
    expect(estimate.rtoMaxMinutes).toBeNull();
    expect(estimate.confidence).toBe('unverified');
  });

  it('returns null RTO values for Aurora backup restore without replicas', () => {
    const estimate = estimateRecovery(
      createEstimateInput('backup_restore', { backupRetentionPeriod: 7 }, 'aurora_cluster'),
    );

    expect(estimate.rtoMaxMinutes).toBeNull();
    expect(estimate.confidence).toBe('unverified');
  });

  it('returns a documented PITR RPO for backup restore when PITR is enabled', () => {
    const estimate = estimateRecovery(
      createEstimateInput('backup_restore', {
        pointInTimeRecoveryEnabled: true,
        latestRestorableTime: '2026-03-27T08:55:00.000Z',
      }),
    );

    expect(estimate.rpoMinMinutes).toBe(0);
    expect(estimate.rpoMaxMinutes).toBe(5);
    expect(
      estimate.factors.some(
        (factor) =>
          factor.name === 'point_in_time_recovery' &&
          factor.source.type === 'aws_documentation',
      ),
    ).toBe(true);
  });

  it('records a no_backup factor when no backup signal is available', () => {
    const estimate = estimateRecovery(createEstimateInput('backup_restore'));

    expect(estimate.factors.some((factor) => factor.name === 'no_backup')).toBe(true);
  });

  it('keeps EFS regional recovery without a failover RTO estimate', () => {
    const estimate = estimateRecovery(
      createEstimateInput('manual', { availabilityZoneName: null }, 'efs_filesystem'),
    );

    expect(estimate.rtoMinMinutes).toBeNull();
    expect(estimate.rtoMaxMinutes).toBeNull();
    expect(estimate.confidence).toBe('unverified');
  });

  it('keeps EFS One Zone recovery without a claimed failover RTO estimate', () => {
    const estimate = estimateRecovery(
      createEstimateInput('manual', { availabilityZoneName: 'eu-west-1a' }, 'efs_filesystem'),
    );

    expect(estimate.rtoMaxMinutes).toBeNull();
    expect(estimate.confidence).toBe('unverified');
  });

  it('caps EFS automatic backup RPO at 24 hours', () => {
    const estimate = estimateRecovery(
      createEstimateInput(
        'manual',
        {
          availabilityZoneName: null,
          automaticBackups: true,
          backupPolicy: { status: 'ENABLED' },
        },
        'efs_filesystem',
      ),
    );

    expect(estimate.rpoMaxMinutes).toBeLessThanOrEqual(1440);
  });

  it('flags missing IaC for full rebuild estimates', () => {
    const estimate = estimateRecovery(createEstimateInput('full_rebuild'));

    expect(estimate.factors.some((factor) => factor.name === 'no_iac')).toBe(true);
    expect(estimate.confidence).toBe('unverified');
  });

  it('detects CloudFormation as IaC for full rebuild estimates', () => {
    const estimate = estimateRecovery(
      createEstimateInput('full_rebuild', { cloudformationStackId: 'stack-123' }),
    );

    expect(estimate.factors.some((factor) => factor.name === 'iac_detected')).toBe(true);
  });

  it('adds a cross-region transfer factor when the input spans multiple regions', () => {
    const estimate = estimateRecovery(
      createEstimateInput(
        'backup_restore',
        { region: 'eu-west-1', targetRegion: 'us-east-1' },
        'aws_rds_instance',
        true,
      ),
    );

    expect(estimate.factors.some((factor) => factor.name === 'cross_region_transfer')).toBe(true);
  });

  it('keeps factor sources inside the declared union', () => {
    const estimates = [
      estimateRecovery(createEstimateInput('hot_standby', { multiAZ: true })),
      estimateRecovery(
        createEstimateInput('warm_standby', {
          readReplicaDBInstanceIdentifiers: ['replica-1'],
        }),
      ),
      estimateRecovery(
        createEstimateInput('backup_restore', {
          allocatedStorage: 200,
          storageType: 'gp3',
          backupRetentionPeriod: 7,
        }),
      ),
      estimateRecovery(createEstimateInput('full_rebuild', { cloudformationStackId: 'stack-123' })),
    ];

    for (const estimate of estimates) {
      for (const factor of estimate.factors) {
        expect(VALID_SOURCE_TYPES.has(factor.source.type)).toBe(true);
      }
    }
  });

  it('returns a non-empty method for every supported strategy', () => {
    const estimates = [
      estimateRecovery(createEstimateInput('hot_standby', { multiAZ: true })),
      estimateRecovery(createEstimateInput('warm_standby', { readReplicaDBInstanceIdentifiers: ['replica-1'] })),
      estimateRecovery(createEstimateInput('backup_restore', { backupRetentionPeriod: 7 })),
      estimateRecovery(createEstimateInput('full_rebuild')),
      estimateRecovery(createEstimateInput('failover')),
      estimateRecovery(createEstimateInput('dns_failover', { ttl: 60 }, 'route53_record')),
      estimateRecovery(createEstimateInput('auto_scaling', {}, 'asg')),
      estimateRecovery(createEstimateInput('manual')),
      estimateRecovery(createEstimateInput('none')),
    ];

    for (const estimate of estimates) {
      expect(estimate.method.length).toBeGreaterThan(0);
    }
  });

  it('always includes limitations for informed and unverified estimates', () => {
    const estimates = [
      estimateRecovery(createEstimateInput('warm_standby', { readReplicaDBInstanceIdentifiers: ['replica-1'] })),
      estimateRecovery(createEstimateInput('backup_restore', { backupRetentionPeriod: 7 })),
      estimateRecovery(createEstimateInput('full_rebuild')),
      estimateRecovery(createEstimateInput('failover')),
      estimateRecovery(createEstimateInput('dns_failover', { ttl: 60 }, 'route53_record')),
      estimateRecovery(createEstimateInput('auto_scaling', {}, 'asg')),
      estimateRecovery(createEstimateInput('manual')),
      estimateRecovery(createEstimateInput('none')),
    ];

    for (const estimate of estimates) {
      if (estimate.confidence !== 'documented') {
        expect(estimate.limitations.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps RTO bounds ordered when both values are present', () => {
    const estimates = [
      estimateRecovery(createEstimateInput('hot_standby', { multiAZ: true })),
      estimateRecovery(createEstimateInput('warm_standby', { readReplicaDBInstanceIdentifiers: ['replica-1'] })),
      estimateRecovery(createEstimateInput('dns_failover', { ttl: 60 }, 'route53_record')),
    ];

    for (const estimate of estimates) {
      if (estimate.rtoMinMinutes !== null && estimate.rtoMaxMinutes !== null) {
        expect(estimate.rtoMinMinutes).toBeLessThanOrEqual(estimate.rtoMaxMinutes);
      }
    }
  });

  it('keeps RPO bounds ordered when both values are present', () => {
    const estimates = [
      estimateRecovery(createEstimateInput('hot_standby', { multiAZ: true })),
      estimateRecovery(createEstimateInput('warm_standby', {
        readReplicaDBInstanceIdentifiers: ['replica-1'],
        replicaLag: 2,
      })),
      estimateRecovery(createEstimateInput('backup_restore', { pointInTimeRecoveryEnabled: true })),
      estimateRecovery(createEstimateInput('dns_failover', { ttl: 60 }, 'route53_record')),
    ];

    for (const estimate of estimates) {
      if (estimate.rpoMinMinutes !== null && estimate.rpoMaxMinutes !== null) {
        expect(estimate.rpoMinMinutes).toBeLessThanOrEqual(estimate.rpoMaxMinutes);
      }
    }
  });

  it('keeps backward-compatible RTO wrappers on the conservative fallback for indeterminate restores', () => {
    const node = createRdsNode('restore-db', {
      backupRetentionPeriod: 7,
      allocatedStorage: 200,
      storageType: 'gp3',
    });

    expect(estimateRTO(node, 'restore_from_backup')).toBe(120);
  });

  it('keeps backward-compatible RPO wrappers on the conservative fallback when no backup exists', () => {
    const node = createRdsNode('rebuild-db', { backupRetentionPeriod: 0 });

    expect(estimateRPO(node, 'restore_from_backup')).toBe(1440);
  });
});

describe('chain RTO propagation', () => {
  it('uses the max RTO across a simple dependency chain', () => {
    const componentA = createRdsNode('component-a', { multiAZ: true });
    const componentB = createRdsNode('component-b', {
      readReplicaDBInstanceIdentifiers: ['replica-1'],
      replicaLag: 2,
      backupRetentionPeriod: 0,
    });
    const plan = createPlan([componentA, componentB], [
      { source: 'component-a', target: 'component-b', type: EdgeType.DEPENDS_ON },
    ]);
    const service = plan.services.find((entry) => entry.name === 'orders');
    const component = service?.components.find((entry) => entry.resourceId === 'component-a');

    expect(component?.effectiveRTO?.chainRTOMax).toBe(30);
  });

  it('propagates null chain RTO when any dependency remains unverified', () => {
    const componentA = createRdsNode('component-a', { multiAZ: true });
    const componentB = createRdsNode('component-b', {
      backupRetentionPeriod: 7,
      allocatedStorage: 200,
      storageType: 'gp3',
    });
    const plan = createPlan([componentA, componentB], [
      { source: 'component-a', target: 'component-b', type: EdgeType.DEPENDS_ON },
    ]);
    const service = plan.services.find((entry) => entry.name === 'orders');
    const component = service?.components.find((entry) => entry.resourceId === 'component-a');

    expect(component?.effectiveRTO?.chainRTOMax).toBeNull();
  });

  it('marks the chain as unverified when any dependency estimate is unverified', () => {
    const componentA = createRdsNode('component-a', { multiAZ: true });
    const componentB = createRdsNode('component-b', {
      backupRetentionPeriod: 7,
      allocatedStorage: 200,
      storageType: 'gp3',
    });
    const plan = createPlan([componentA, componentB], [
      { source: 'component-a', target: 'component-b', type: EdgeType.DEPENDS_ON },
    ]);
    const service = plan.services.find((entry) => entry.name === 'orders');
    const component = service?.components.find((entry) => entry.resourceId === 'component-a');

    expect(component?.effectiveRTO?.chainContainsUnverified).toBe(true);
    expect(component?.warnings).toContain(
      'Chain RTO requires testing because at least one component in the dependency chain is unverified.',
    );
  });

  it('records the dependency bottleneck when it dominates the chain RTO', () => {
    const componentA = createRdsNode('component-a', { multiAZ: true });
    const componentB = createRdsNode('component-b', {
      readReplicaDBInstanceIdentifiers: ['replica-1'],
      replicaLag: 2,
      backupRetentionPeriod: 0,
    });
    const plan = createPlan([componentA, componentB], [
      { source: 'component-a', target: 'component-b', type: EdgeType.DEPENDS_ON },
    ]);
    const service = plan.services.find((entry) => entry.name === 'orders');
    const component = service?.components.find((entry) => entry.resourceId === 'component-a');

    expect(component?.effectiveRTO?.bottleneck).toBe('component-b');
  });

  it('always uses the sequential_restore assumption in v0.1', () => {
    const componentA = createRdsNode('component-a', { multiAZ: true });
    const componentB = createRdsNode('component-b', {
      readReplicaDBInstanceIdentifiers: ['replica-1'],
      replicaLag: 2,
      backupRetentionPeriod: 0,
    });
    const plan = createPlan([componentA, componentB], [
      { source: 'component-a', target: 'component-b', type: EdgeType.DEPENDS_ON },
    ]);
    const service = plan.services.find((entry) => entry.name === 'orders');
    const component = service?.components.find((entry) => entry.resourceId === 'component-a');

    expect(component?.effectiveRTO?.assumption).toBe('sequential_restore');
  });

  it('uses the max RTO across a three-component sequential chain', () => {
    const componentA = createRdsNode('component-a', { multiAZ: true });
    const componentB = createRdsNode('component-b', {
      readReplicaDBInstanceIdentifiers: ['replica-1'],
      replicaLag: 2,
      backupRetentionPeriod: 0,
    });
    const componentC = createRdsNode('component-c', { multiAZ: true });
    const plan = createPlan(
      [componentA, componentB, componentC],
      [
        { source: 'component-a', target: 'component-b', type: EdgeType.DEPENDS_ON },
        { source: 'component-b', target: 'component-c', type: EdgeType.DEPENDS_ON },
      ],
    );
    const service = plan.services.find((entry) => entry.name === 'orders');

    expect(
      service?.components.find((entry) => entry.resourceId === 'component-a')?.effectiveRTO
        ?.chainRTOMax,
    ).toBe(30);
    expect(
      service?.components.find((entry) => entry.resourceId === 'component-b')?.effectiveRTO
        ?.chainRTOMax,
    ).toBe(30);
    expect(
      service?.components.find((entry) => entry.resourceId === 'component-c')?.effectiveRTO
        ?.chainRTOMax,
    ).toBe(5);
  });

  it('propagates null chain RTO through the whole chain when the deepest dependency is unverified', () => {
    const componentA = createRdsNode('component-a', { multiAZ: true });
    const componentB = createRdsNode('component-b', {
      readReplicaDBInstanceIdentifiers: ['replica-1'],
      replicaLag: 2,
      backupRetentionPeriod: 0,
    });
    const componentC = createRdsNode('component-c', {
      backupRetentionPeriod: 7,
      allocatedStorage: 200,
      storageType: 'gp3',
    });
    const plan = createPlan(
      [componentA, componentB, componentC],
      [
        { source: 'component-a', target: 'component-b', type: EdgeType.DEPENDS_ON },
        { source: 'component-b', target: 'component-c', type: EdgeType.DEPENDS_ON },
      ],
    );
    const service = plan.services.find((entry) => entry.name === 'orders');

    expect(
      service?.components.find((entry) => entry.resourceId === 'component-a')?.effectiveRTO
        ?.chainRTOMax,
    ).toBeNull();
    expect(
      service?.components.find((entry) => entry.resourceId === 'component-b')?.effectiveRTO
        ?.chainRTOMax,
    ).toBeNull();
  });
});
