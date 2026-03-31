import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';
import { EdgeType, NodeType, type InfraNodeAttrs } from '../types/index.js';
import {
  calculateBlastRadius,
  type BlastEdge,
  type BlastRadiusResult,
} from './blast-radius-engine.js';

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

function addDependency(
  graph: TestGraph,
  dependentId: string,
  dependencyId: string,
  type = EdgeType.NETWORK_ACCESS,
): void {
  graph.addEdgeWithKey(`${dependentId}->${dependencyId}:${type}`, dependentId, dependencyId, {
    type,
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

function getResult(results: BlastRadiusResult[], nodeId: string): BlastRadiusResult {
  const result = results.find((entry) => entry.nodeId === nodeId);
  expect(result).toBeDefined();
  return result!;
}

function buildFiveNodeScenario(): BlastRadiusResult[] {
  const graph = createGraph();

  addNode(graph, makeNode({ id: 'gateway', name: 'public-api', type: NodeType.API_GATEWAY }));
  addNode(graph, makeNode({ id: 'api', name: 'orders-api', type: NodeType.APPLICATION }));
  addNode(
    graph,
    makeNode({
      id: 'worker',
      name: 'billing-worker',
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
      name: 'orders-rds',
      type: NodeType.DATABASE,
      metadata: { sourceType: 'aws_rds_instance' },
    }),
  );

  addDependency(graph, 'gateway', 'api', EdgeType.DEPENDS_ON);
  addDependency(graph, 'api', 'db', EdgeType.DEPENDS_ON);
  addDependency(graph, 'worker', 'db', EdgeType.DEPENDS_ON);
  addDependency(graph, 'reporting', 'db', EdgeType.DEPENDS_ON);

  const { nodes, edges } = toBlastInput(graph);
  return calculateBlastRadius(nodes, edges);
}

describe('calculateBlastRadius', () => {
  it('calculates blast radius on a simple five-node graph', () => {
    const results = buildFiveNodeScenario();
    const dbBlast = getResult(results, 'db');

    expect(results).toHaveLength(5);
    expect(dbBlast.directDependents).toBe(3);
    expect(dbBlast.transitiveDependents).toBe(4);
    expect(dbBlast.totalServices).toBe(5);
    expect(dbBlast.impactRatio).toBe(1);
    expect(dbBlast.impactedServices).toEqual(['api', 'gateway', 'reporting', 'worker']);
  });

  it('gives a high blast radius to a critical node with many dependents', () => {
    const results = buildFiveNodeScenario();
    const dbBlast = getResult(results, 'db');

    expect(dbBlast.directDependents).toBeGreaterThanOrEqual(3);
    expect(dbBlast.transitiveDependents).toBeGreaterThanOrEqual(4);
    expect(dbBlast.impactRatio).toBeGreaterThan(0.5);
    expect(dbBlast.rationale).toContain('impactes en cascade');
  });

  it('keeps a leaf node to a self-only blast radius', () => {
    const results = buildFiveNodeScenario();
    const leafBlast = getResult(results, 'gateway');

    expect(leafBlast.directDependents).toBe(0);
    expect(leafBlast.transitiveDependents).toBe(0);
    expect(leafBlast.impactRatio).toBe(0);
    expect(leafBlast.impactedServices).toEqual([]);
    expect(leafBlast.transitiveDependents + 1).toBe(1);
  });
});
