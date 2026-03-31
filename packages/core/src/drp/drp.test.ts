import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';
import type { GraphAnalysisReport } from '../types/index.js';
import { NodeType, type InfraNodeAttrs } from '../types/index.js';
import {
  deserializeDRPlan,
  estimateRPO,
  estimateRTO,
  generateDRPlan,
  inferRecoveryStrategy,
  serializeDRPlan,
  validateDRPlan,
} from './index.js';

type TestGraph = DirectedGraph<Record<string, unknown>, Record<string, unknown>>;

interface TestEdge {
  readonly source: string;
  readonly target: string;
  readonly type: string;
}

const FIXED_TIMESTAMP = new Date('2026-03-26T10:00:00.000Z');

const BASE_NODE_FIXTURES: readonly InfraNodeAttrs[] = [
  {
    id: 'orders-db',
    name: 'orders-db',
    type: NodeType.DATABASE,
    provider: 'aws',
    region: 'eu-west-1',
    tags: { Service: 'orders' },
    metadata: {
      sourceType: 'aws_rds_instance',
      multiAZ: true,
      backupRetentionPeriod: 7,
      endpointAddress: 'orders-db.internal',
      dbIdentifier: 'orders-db',
      storageEncrypted: true,
    },
    criticalityScore: 95,
  },
  {
    id: 'orders-api',
    name: 'orders-api',
    type: NodeType.APPLICATION,
    provider: 'aws',
    region: 'eu-west-1',
    tags: { Service: 'orders' },
    metadata: {
      sourceType: 'orders_service',
    },
    criticalityScore: 80,
  },
  {
    id: 'backup-bucket',
    name: 'backup-bucket',
    type: NodeType.OBJECT_STORAGE,
    provider: 'aws',
    region: 'eu-west-1',
    tags: { Service: 'orders' },
    metadata: {
      sourceType: 'S3_BUCKET',
      bucketName: 'backup-bucket',
      versioningStatus: 'Enabled',
      encrypted: true,
    },
    criticalityScore: 50,
  },
];

const BASE_EDGE_FIXTURES: readonly TestEdge[] = [];

function cloneNode(node: InfraNodeAttrs): InfraNodeAttrs {
  return {
    ...node,
    tags: { ...node.tags },
    metadata: { ...node.metadata },
  };
}

function createGraph(
  nodes: readonly InfraNodeAttrs[] = BASE_NODE_FIXTURES,
  edges: readonly TestEdge[] = BASE_EDGE_FIXTURES,
): TestGraph {
  const graph = new DirectedGraph<Record<string, unknown>, Record<string, unknown>>();

  for (const node of nodes.map(cloneNode)) {
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
    resilienceScore: 85,
  };
}

function createPlanFixture() {
  const graph = createGraph();
  return {
    graph,
    plan: generateDRPlan({
      graph,
      analysis: createAnalysis(graph),
      provider: 'aws',
      generatedAt: FIXED_TIMESTAMP,
    }),
  };
}

function createServiceNode(id: string, criticalityScore: number): InfraNodeAttrs {
  return {
    id,
    name: id,
    type: NodeType.APPLICATION,
    provider: 'aws',
    region: 'eu-west-1',
    tags: { Service: 'orders' },
    metadata: {
      sourceType: 'orders_service',
    },
    criticalityScore,
  };
}

describe('inferRecoveryStrategy', () => {
  it('should return a valid strategy for an RDS node with Multi-AZ enabled', () => {
    const node = cloneNode(BASE_NODE_FIXTURES[0]!);

    expect(inferRecoveryStrategy(node)).toBe('failover');
  });

  it('should return a valid strategy for an S3 node', () => {
    const node = cloneNode(BASE_NODE_FIXTURES[2]!);

    expect(inferRecoveryStrategy(node)).toBe('restore_from_backup');
  });

  it('should return the fallback strategy for an unknown node type', () => {
    const node: InfraNodeAttrs = {
      id: 'mystery-service',
      name: 'mystery-service',
      type: NodeType.APPLICATION,
      provider: 'aws',
      region: 'eu-west-1',
      tags: {},
      metadata: { sourceType: 'custom_widget' },
    };

    expect(inferRecoveryStrategy(node)).toBe('none');
  });
});

describe('estimateRTO / estimateRPO', () => {
  it('should return a numeric RTO greater than zero for a known strategy', () => {
    const node = cloneNode(BASE_NODE_FIXTURES[0]!);

    expect(estimateRTO(node, 'failover')).toBeGreaterThan(0);
  });

  it('should return a numeric RPO greater than zero for a known strategy', () => {
    const node = cloneNode(BASE_NODE_FIXTURES[0]!);

    expect(estimateRPO(node, 'restore_from_backup')).toBeGreaterThan(0);
  });

  it('should keep RTO estimates ordered from failover to restore to full rebuild', () => {
    const node = cloneNode(BASE_NODE_FIXTURES[0]!);

    expect(estimateRTO(node, 'failover')).toBeLessThan(estimateRTO(node, 'restore_from_backup'));
    expect(estimateRTO(node, 'restore_from_backup')).toBeLessThan(
      estimateRTO(node, 'full_rebuild'),
    );
  });
});

describe('generateDRPlan', () => {
  it('should generate a plan with an id, version, and service components and recovery order', () => {
    const { plan } = createPlanFixture();

    expect(plan.id).toMatch(/^drp-/);
    expect(plan.version).toBeTruthy();
    expect(plan.services[0]?.components.length ?? 0).toBeGreaterThan(0);
    expect(plan.services[0]?.recoveryOrder.length ?? 0).toBeGreaterThan(0);
  });

  it('should order service recovery steps by descending criticality when dependencies do not override it', () => {
    const { plan } = createPlanFixture();
    const ordersService = plan.services.find((service) => service.name === 'orders');

    expect(ordersService?.recoveryOrder).toEqual(['orders-db', 'orders-api', 'backup-bucket']);
  });

  it('should include a non-empty infrastructure hash in the generated plan', () => {
    const { plan } = createPlanFixture();

    expect(plan.infrastructureHash.length).toBeGreaterThan(0);
  });

  it('should place dependencies before the components that depend on them', () => {
    const api = cloneNode({
      ...BASE_NODE_FIXTURES[1]!,
      criticalityScore: 99,
    });
    const database = cloneNode({
      ...BASE_NODE_FIXTURES[0]!,
      criticalityScore: 10,
    });
    const graph = createGraph([api, database], [
      { source: 'orders-api', target: 'orders-db', type: 'DEPENDS_ON' },
    ]);
    const plan = generateDRPlan({
      graph,
      analysis: createAnalysis(graph),
      provider: 'aws',
      generatedAt: FIXED_TIMESTAMP,
    });

    expect(plan.services.find((service) => service.name === 'orders')?.recoveryOrder).toEqual([
      'orders-db',
      'orders-api',
    ]);
  });

  it('should keep standalone high-criticality components first when no dependency overrides the order', () => {
    const graph = createGraph([
      createServiceNode('primary-api', 95),
      createServiceNode('secondary-worker', 20),
    ]);
    const plan = generateDRPlan({
      graph,
      analysis: createAnalysis(graph),
      provider: 'aws',
      generatedAt: FIXED_TIMESTAMP,
    });

    expect(plan.services.find((service) => service.name === 'orders')?.recoveryOrder).toEqual([
      'primary-api',
      'secondary-worker',
    ]);
  });

  it('should break cycles deterministically and include each component only once', () => {
    const graph = createGraph(
      [
        createServiceNode('cycle-a', 50),
        createServiceNode('cycle-b', 50),
      ],
      [
        { source: 'cycle-a', target: 'cycle-b', type: 'DEPENDS_ON' },
        { source: 'cycle-b', target: 'cycle-a', type: 'DEPENDS_ON' },
      ],
    );
    const plan = generateDRPlan({
      graph,
      analysis: createAnalysis(graph),
      provider: 'aws',
      generatedAt: FIXED_TIMESTAMP,
    });
    const recoveryOrder = plan.services.find((service) => service.name === 'orders')?.recoveryOrder;

    expect(recoveryOrder).toEqual(['cycle-b', 'cycle-a']);
    expect(new Set(recoveryOrder)).toEqual(new Set(['cycle-a', 'cycle-b']));
  });
});

describe('serializeDRPlan / deserializeDRPlan', () => {
  it('should round-trip a plan through YAML serialization', () => {
    const { plan } = createPlanFixture();
    const result = deserializeDRPlan(serializeDRPlan(plan, 'yaml'), 'yaml');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(plan);
  });

  it('should round-trip a plan through JSON serialization', () => {
    const { plan } = createPlanFixture();
    const result = deserializeDRPlan(serializeDRPlan(plan, 'json'), 'json');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(plan);
  });

  it('should serialize YAML as a valid YAML document start', () => {
    const { plan } = createPlanFixture();
    const yaml = serializeDRPlan(plan, 'yaml');

    expect(/^(#|id:|version:)/.test(yaml)).toBe(true);
  });
});

describe('validateDRPlan', () => {
  it('should validate a plan generated from the same infrastructure', () => {
    const { graph, plan } = createPlanFixture();
    const report = validateDRPlan(plan, graph);

    expect(report.isValid).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('should report issues when a generated plan references a removed component', () => {
    const { plan } = createPlanFixture();
    const graph = createGraph(
      BASE_NODE_FIXTURES.filter((node) => node.id !== 'backup-bucket'),
      BASE_EDGE_FIXTURES,
    );
    const report = validateDRPlan(plan, graph);

    expect(report.isValid).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_component',
          resourceId: 'backup-bucket',
        }),
      ]),
    );
  });
});
