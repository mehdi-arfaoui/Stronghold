import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';
import { EdgeType, NodeType, type InfraNodeAttrs } from '../types/index.js';
import { DEFAULT_RESOLVER } from './analysis-helpers.js';
import { analyzeFullGraph } from './graph-analysis-engine.js';

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
  type = EdgeType.DEPENDS_ON,
): void {
  graph.addEdgeWithKey(`${dependentId}->${dependencyId}:${type}`, dependentId, dependencyId, {
    type,
    confidence: 1,
    confirmed: true,
  });
}

describe('analyzeFullGraph', () => {
  it('returns SPOFs, criticality scores, regional risks, and cascade chains for a hub topology', async () => {
    const graph = createGraph();

    addNode(graph, makeNode({ id: 'hub', name: 'orders-control-plane', type: NodeType.APPLICATION }));
    for (let index = 1; index <= 5; index++) {
      addNode(
        graph,
        makeNode({
          id: `leaf-${index}`,
          name: `service-${index}`,
          type: NodeType.APPLICATION,
        }),
      );
      addDependency(graph, `leaf-${index}`, 'hub');
    }

    const report = await analyzeFullGraph(graph, DEFAULT_RESOLVER);
    const hubSpof = report.spofs.find((item) => item.nodeId === 'hub');

    expect(report.totalNodes).toBe(6);
    expect(report.totalEdges).toBe(5);
    expect(hubSpof).toBeDefined();
    expect(report.criticalityScores.get('hub')).toBeGreaterThan(
      report.criticalityScores.get('leaf-1') ?? 0,
    );
    expect(report.regionalRisks).toEqual(
      expect.arrayContaining([expect.objectContaining({ region: 'eu-west-1', risk: 'critical' })]),
    );
    expect(report.cascadeChains[0]).toEqual(
      expect.objectContaining({ sourceNodeId: 'hub', totalImpacted: 5 }),
    );
    expect((graph.getNodeAttributes('hub') as InfraNodeAttrs).blastRadius).toBe(5);
    expect((graph.getNodeAttributes('hub') as InfraNodeAttrs).isSPOF).toBe(true);
  });

  it('does not flag a node as a SPOF when alternate paths keep the graph connected', async () => {
    const graph = createGraph();

    addNode(graph, makeNode({ id: 'frontend', name: 'frontend', type: NodeType.APPLICATION }));
    addNode(graph, makeNode({ id: 'shared-api', name: 'shared-api', type: NodeType.APPLICATION }));
    addNode(graph, makeNode({ id: 'worker', name: 'worker', type: NodeType.APPLICATION }));

    addDependency(graph, 'frontend', 'shared-api');
    addDependency(graph, 'frontend', 'worker');
    addDependency(graph, 'worker', 'shared-api');

    const report = await analyzeFullGraph(graph, DEFAULT_RESOLVER);

    expect(report.spofs.find((item) => item.nodeId === 'shared-api')).toBeUndefined();
    expect(report.circularDeps).toHaveLength(0);
  });

  it('records the blast radius of direct dependents without counting the node itself', async () => {
    const graph = createGraph();

    addNode(
      graph,
      makeNode({
        id: 'database',
        name: 'orders-db',
        type: NodeType.DATABASE,
        metadata: { sourceType: 'aws_rds_instance' },
      }),
    );
    addNode(graph, makeNode({ id: 'api', name: 'api', type: NodeType.APPLICATION }));
    addNode(graph, makeNode({ id: 'worker', name: 'worker', type: NodeType.APPLICATION }));

    addDependency(graph, 'api', 'database');
    addDependency(graph, 'worker', 'database');

    const report = await analyzeFullGraph(graph, DEFAULT_RESOLVER);

    expect((graph.getNodeAttributes('database') as InfraNodeAttrs).blastRadius).toBe(2);
    expect(report.spofs.find((item) => item.nodeId === 'database')?.blastRadius).toBe(2);
  });

  it('detects circular dependencies without looping forever', async () => {
    const graph = createGraph();

    addNode(graph, makeNode({ id: 'service-a', name: 'service-a', type: NodeType.APPLICATION }));
    addNode(graph, makeNode({ id: 'service-b', name: 'service-b', type: NodeType.APPLICATION }));

    addDependency(graph, 'service-a', 'service-b');
    addDependency(graph, 'service-b', 'service-a');

    const report = await analyzeFullGraph(graph, DEFAULT_RESOLVER);

    expect(report.circularDeps).toEqual([
      {
        nodes: [
          { id: 'service-a', name: 'service-a' },
          { id: 'service-b', name: 'service-b' },
        ],
        length: 2,
      },
    ]);
  });

  it('handles an empty graph gracefully', async () => {
    const report = await analyzeFullGraph(createGraph(), DEFAULT_RESOLVER);

    expect(report.totalNodes).toBe(0);
    expect(report.totalEdges).toBe(0);
    expect(report.spofs).toEqual([]);
    expect(report.redundancyIssues).toEqual([]);
    expect(report.regionalRisks).toEqual([]);
    expect(report.circularDeps).toEqual([]);
    expect(report.cascadeChains).toEqual([]);
  });
});
