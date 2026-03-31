import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';
import type { CloudServiceResolver } from '../ports/cloud-service-resolver.js';
import { EdgeType, NodeType, type InfraNodeAttrs } from '../types/index.js';
import { analyzeRedundancy } from './redundancy-analysis.js';

type TestGraph = DirectedGraph<Record<string, unknown>, Record<string, unknown>>;

const TEST_RESOLVER: CloudServiceResolver = ({ nodeType, metadata }) => {
  const sourceType = typeof metadata.sourceType === 'string' ? metadata.sourceType.toLowerCase() : '';

  if (sourceType.includes('sqs')) {
    return {
      provider: 'aws',
      category: 'messaging',
      kind: 'sqs',
      nodeType,
      sourceType,
      metadata,
      descriptors: [],
    };
  }

  return {
    provider: 'aws',
    category: 'unknown',
    kind: sourceType || nodeType.toLowerCase(),
    nodeType,
    sourceType,
    metadata,
    descriptors: [],
  };
};

function createGraph(): TestGraph {
  return new DirectedGraph();
}

function makeNode(
  overrides: Partial<InfraNodeAttrs> & Pick<InfraNodeAttrs, 'id' | 'name' | 'type'>,
): InfraNodeAttrs {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    provider: 'aws',
    region: 'eu-west-1',
    tags: {},
    metadata: {},
    ...overrides,
  };
}

function addNode(graph: TestGraph, node: InfraNodeAttrs): void {
  graph.addNode(node.id, node as unknown as Record<string, unknown>);
}

function addEdge(graph: TestGraph, source: string, target: string, type: EdgeType): void {
  graph.addEdgeWithKey(`${source}->${target}:${type}`, source, target, {
    type,
    confidence: 1,
    confirmed: true,
  });
}

describe('analyzeRedundancy', () => {
  it('flags a single EC2 instance outside an ASG as non-redundant', () => {
    const graph = createGraph();
    addNode(
      graph,
      makeNode({
        id: 'i-123',
        name: 'orders-api',
        type: NodeType.VM,
        availabilityZone: 'eu-west-1a',
        metadata: { sourceType: 'ec2_instance' },
      }),
    );

    const issue = analyzeRedundancy(graph, TEST_RESOLVER).find((entry) => entry.nodeId === 'i-123');

    expect(issue?.failedChecks.map((check) => check.check)).toEqual(
      expect.arrayContaining(['single_instance', 'load_balancer']),
    );
  });

  it('treats an EC2 instance in an ASG behind a load balancer as redundant', () => {
    const graph = createGraph();
    addNode(
      graph,
      makeNode({
        id: 'i-123',
        name: 'orders-api',
        type: NodeType.VM,
        availabilityZone: 'eu-west-1a',
        metadata: {
          sourceType: 'ec2_instance',
          autoScalingGroupName: 'orders-asg',
          instanceGroupSize: 2,
        },
      }),
    );
    addNode(
      graph,
      makeNode({
        id: 'alb-1',
        name: 'orders-alb',
        type: NodeType.LOAD_BALANCER,
      }),
    );
    addEdge(graph, 'alb-1', 'i-123', EdgeType.ROUTES_TO);

    expect(analyzeRedundancy(graph, TEST_RESOLVER).find((entry) => entry.nodeId === 'i-123')).toBeUndefined();
  });

  it('reports missing HA, replicas, and backups for a standalone RDS instance', () => {
    const graph = createGraph();
    addNode(
      graph,
      makeNode({
        id: 'db-primary',
        name: 'db-primary',
        type: NodeType.DATABASE,
        metadata: {
          sourceType: 'aws_rds_instance',
          backupRetentionPeriod: 0,
          replicaCount: 0,
          multiAZ: false,
        },
      }),
    );

    const issue = analyzeRedundancy(graph, TEST_RESOLVER).find(
      (entry) => entry.nodeId === 'db-primary',
    );

    expect(issue?.failedChecks.map((check) => check.check)).toEqual(
      expect.arrayContaining(['multi_az', 'read_replicas', 'backup']),
    );
  });

  it('flags an SQS queue without a dead-letter queue', () => {
    const graph = createGraph();
    addNode(
      graph,
      makeNode({
        id: 'orders-queue',
        name: 'orders-queue',
        type: NodeType.MESSAGE_QUEUE,
        metadata: { sourceType: 'SQS_QUEUE' },
      }),
    );

    const issue = analyzeRedundancy(graph, TEST_RESOLVER).find(
      (entry) => entry.nodeId === 'orders-queue',
    );

    expect(issue?.failedChecks.map((check) => check.check)).toContain('dlq');
  });

  it('flags cache tiers without replication', () => {
    const graph = createGraph();
    addNode(
      graph,
      makeNode({
        id: 'cache-main',
        name: 'cache-main',
        type: NodeType.CACHE,
        metadata: {
          sourceType: 'elasticache',
          tier: 'BASIC',
          replicaCount: 0,
        },
      }),
    );

    const issue = analyzeRedundancy(graph, TEST_RESOLVER).find(
      (entry) => entry.nodeId === 'cache-main',
    );

    expect(issue?.failedChecks.map((check) => check.check)).toContain('cache_replication');
  });
});
