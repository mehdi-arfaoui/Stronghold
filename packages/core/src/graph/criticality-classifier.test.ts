import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';
import { EdgeType, NodeType, type InfraNodeAttrs } from '../types/index.js';
import {
  calculateBlastRadius,
  type BlastEdge,
  type BlastRadiusResult,
} from './blast-radius-engine.js';
import { classifyServiceCriticality } from './criticality-classifier.js';

type TestGraph = DirectedGraph<Record<string, unknown>, Record<string, unknown>>;

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

function addDependency(graph: TestGraph, dependentId: string, dependencyId: string): void {
  graph.addEdgeWithKey(`${dependentId}->${dependencyId}`, dependentId, dependencyId, {
    type: EdgeType.DEPENDS_ON,
  });
}

function toBlastInput(graph: TestGraph): { nodes: InfraNodeAttrs[]; edges: BlastEdge[] } {
  const nodes: InfraNodeAttrs[] = [];
  const edges: BlastEdge[] = [];

  graph.forEachNode((_nodeId, attrs) => {
    nodes.push(attrs as unknown as InfraNodeAttrs);
  });

  graph.forEachEdge((_edgeKey, attrs, source, target) => {
    edges.push({
      sourceId: source,
      targetId: target,
      type: String(attrs.type ?? ''),
    });
  });

  return { nodes, edges };
}

function getBlastRadiusFor(graph: TestGraph, nodeId: string): BlastRadiusResult {
  const { nodes, edges } = toBlastInput(graph);
  const result = calculateBlastRadius(nodes, edges).find((entry) => entry.nodeId === nodeId);
  expect(result).toBeDefined();
  return result!;
}

describe('classifyServiceCriticality', () => {
  it('classifies an RDS node with many dependents as CRITICAL', () => {
    const graph = createGraph();

    addNode(
      graph,
      makeNode({
        id: 'gateway',
        name: 'public-api',
        type: NodeType.API_GATEWAY,
      }),
    );
    addNode(
      graph,
      makeNode({
        id: 'orders-api',
        name: 'orders-api',
        type: NodeType.APPLICATION,
      }),
    );
    addNode(
      graph,
      makeNode({
        id: 'worker',
        name: 'payments-worker',
        type: NodeType.MICROSERVICE,
      }),
    );
    addNode(
      graph,
      makeNode({
        id: 'reporting',
        name: 'reporting-service',
        type: NodeType.APPLICATION,
      }),
    );
    addNode(
      graph,
      makeNode({
        id: 'db',
        name: 'prod-main-rds',
        type: NodeType.DATABASE,
        metadata: { sourceType: 'aws_rds_instance' },
      }),
    );

    addDependency(graph, 'gateway', 'orders-api');
    addDependency(graph, 'orders-api', 'db');
    addDependency(graph, 'worker', 'db');
    addDependency(graph, 'reporting', 'db');

    const dbNode = graph.getNodeAttributes('db') as unknown as InfraNodeAttrs;
    const dbBlast = getBlastRadiusFor(graph, 'db');
    const classification = classifyServiceCriticality(dbNode, dbBlast);

    expect(classification.tier).toBe(1);
    expect(classification.impactCategory).toBe('critical');
    expect(classification.confidence).toBeGreaterThanOrEqual(0.7);
    expect(classification.signals).toEqual(
      expect.arrayContaining(['Blast radius: 100%', 'Type: DATABASE', 'Nom: prod-main-rds']),
    );
  });

  it('classifies an S3 node without dependents as LOW', () => {
    const graph = createGraph();

    addNode(
      graph,
      makeNode({
        id: 'archive',
        name: 'archive-bucket',
        type: NodeType.OBJECT_STORAGE,
        metadata: { sourceType: 'aws_s3_bucket' },
      }),
    );
    addNode(
      graph,
      makeNode({
        id: 'dev-tooling',
        name: 'dev-tooling',
        type: NodeType.APPLICATION,
      }),
    );

    const archiveNode = graph.getNodeAttributes('archive') as unknown as InfraNodeAttrs;
    const archiveBlast = getBlastRadiusFor(graph, 'archive');
    const classification = classifyServiceCriticality(archiveNode, archiveBlast);

    expect(archiveBlast.directDependents).toBe(0);
    expect(archiveBlast.transitiveDependents).toBe(0);
    expect(classification.tier).toBe(4);
    expect(classification.impactCategory).toBe('low');
    expect(classification.signals).toEqual(
      expect.arrayContaining(['Blast radius: 0%', 'Type: OBJECT_STORAGE']),
    );
  });
});
