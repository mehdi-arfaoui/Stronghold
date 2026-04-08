import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';
import {
  NodeType,
  EdgeType,
  type InfraNodeAttrs,
  type SimulationScenario,
} from '../types/index.js';
import type { GraphInstance } from './graph-instance.js';
import { runSimulation } from './graph-scenario-engine.js';

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
  });
}

function asGraphInstance(graph: TestGraph): GraphInstance {
  return graph as unknown as GraphInstance;
}

describe('runSimulation', () => {
  it('propagates a failure from a node to its dependents', () => {
    const graph = createGraph();

    addNode(
      graph,
      makeNode({
        id: 'api',
        name: 'public-api',
        type: NodeType.API_GATEWAY,
        validatedRTO: 30,
      }),
    );
    addNode(
      graph,
      makeNode({
        id: 'app',
        name: 'orders-app',
        type: NodeType.APPLICATION,
        validatedRTO: 45,
      }),
    );
    addNode(
      graph,
      makeNode({
        id: 'db',
        name: 'orders-db',
        type: NodeType.DATABASE,
        validatedRTO: 60,
        financialImpactPerHour: 500,
        metadata: { sourceType: 'aws_rds_instance' },
      }),
    );

    addDependency(graph, 'api', 'app');
    addDependency(graph, 'app', 'db');

    const scenario: SimulationScenario = {
      scenarioType: 'custom',
      params: { nodes: ['db'] },
      name: 'Database outage',
    };

    const result = runSimulation(asGraphInstance(graph), scenario);
    const appCascade = result.cascadeImpacted.find((node) => node.id === 'app');
    const apiCascade = result.cascadeImpacted.find((node) => node.id === 'api');

    expect(result.directlyAffected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'db',
          name: 'orders-db',
          type: NodeType.DATABASE,
          status: 'down',
        }),
      ]),
    );
    expect(appCascade).toEqual(
      expect.objectContaining({
        id: 'app',
        status: 'down',
        cascadeDepth: 1,
      }),
    );
    expect(apiCascade).toEqual(
      expect.objectContaining({
        id: 'api',
        status: 'down',
        cascadeDepth: 2,
      }),
    );
    expect(result.businessImpact).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceId: 'app',
          impact: 'total_outage',
        }),
        expect.objectContaining({
          serviceId: 'api',
          impact: 'total_outage',
        }),
      ]),
    );
  });

  it('does not propagate the failure past a node with redundancy', () => {
    const graph = createGraph();

    addNode(
      graph,
      makeNode({
        id: 'frontend',
        name: 'customer-portal',
        type: NodeType.APPLICATION,
      }),
    );
    addNode(
      graph,
      makeNode({
        id: 'app',
        name: 'orders-service',
        type: NodeType.MICROSERVICE,
      }),
    );
    addNode(
      graph,
      makeNode({
        id: 'primary-db',
        name: 'orders-primary',
        type: NodeType.DATABASE,
        metadata: { sourceType: 'aws_rds_instance' },
      }),
    );
    addNode(
      graph,
      makeNode({
        id: 'replica-db',
        name: 'orders-replica',
        type: NodeType.DATABASE,
        metadata: { sourceType: 'aws_rds_read_replica' },
      }),
    );

    addDependency(graph, 'frontend', 'app');
    addDependency(graph, 'app', 'primary-db');
    addDependency(graph, 'app', 'replica-db');

    const scenario: SimulationScenario = {
      scenarioType: 'custom',
      params: { nodes: ['primary-db'] },
      name: 'Primary database outage',
    };

    const result = runSimulation(asGraphInstance(graph), scenario);
    const appCascade = result.cascadeImpacted.find((node) => node.id === 'app');
    const frontendCascade = result.cascadeImpacted.find((node) => node.id === 'frontend');

    expect(appCascade).toEqual(
      expect.objectContaining({
        id: 'app',
        status: 'degraded',
        cascadeDepth: 1,
      }),
    );
    expect(frontendCascade).toBeUndefined();
    expect(result.businessImpact).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceId: 'app',
          impact: 'degraded',
        }),
      ]),
    );
    expect(
      result.businessImpact.find((service) => service.serviceId === 'frontend'),
    ).toBeUndefined();
  });
});
