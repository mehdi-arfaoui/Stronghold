import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';

import {
  analyzeScenario,
  selectByAZ,
  selectByNodeId,
  selectByRegion,
  selectByServiceType,
} from '../scenario-engine.js';
import type { Scenario } from '../scenario-types.js';
import type { Service } from '../../services/service-types.js';
import type { InfraNodeAttrs } from '../../types/infrastructure.js';

type GraphRecord = Record<string, unknown>;
type ResourceRoleSpec = NonNullable<Service['resources'][number]['role']>;
type ResourceSpec = readonly [string, ResourceRoleSpec];

describe('scenario-engine helpers', () => {
  it('selects nodes by availability zone', () => {
    const nodes = [
      createNode('api-a', 'VM', 'eu-west-3', 'eu-west-3a'),
      createNode('api-b', 'VM', 'eu-west-3', 'eu-west-3b'),
    ];

    expect(selectByAZ(nodes, 'eu-west-3a')).toEqual(['api-a']);
  });

  it('selects nodes by region', () => {
    const nodes = [
      createNode('api-fr', 'VM', 'eu-west-3', 'eu-west-3a'),
      createNode('api-ie', 'VM', 'eu-west-1', 'eu-west-1a'),
    ];

    expect(selectByRegion(nodes, 'eu-west-1')).toEqual(['api-ie']);
  });

  it('selects nodes by service type', () => {
    const nodes = [
      createNode('db', 'DATABASE', 'eu-west-3', 'eu-west-3a', { sourceType: 'rds' }),
      createNode('api', 'VM', 'eu-west-3', 'eu-west-3a', { sourceType: 'ec2' }),
    ];

    expect(selectByServiceType(nodes, 'rds')).toEqual(['db']);
  });

  it('selects a single node by id', () => {
    expect(selectByNodeId('payment-db')).toEqual(['payment-db']);
  });
});

describe('analyzeScenario', () => {
  it('returns no impact for an empty graph', () => {
    const graph = new DirectedGraph<GraphRecord, GraphRecord>();

    const scenario = createScenario('node-failure-empty', ['missing-node'], 'node_failure');
    const analyzed = analyzeScenario({
      graph,
      nodes: [],
      services: [],
      scenario,
      drp: null,
      evidence: [],
    });

    expect(analyzed.impact).toMatchObject({
      totalAffectedNodes: 0,
      totalAffectedServices: [],
    });
    expect(analyzed.coverage?.verdict).toBe('covered');
  });

  it('handles circular dependencies without looping forever', () => {
    const nodes = [
      createNode('api', 'VM', 'eu-west-3', 'eu-west-3a'),
      createNode('worker', 'VM', 'eu-west-3', 'eu-west-3a'),
    ];
    const graph = createGraph(nodes, [
      { source: 'api', target: 'worker', type: 'depends_on' },
      { source: 'worker', target: 'api', type: 'depends_on' },
    ]);
    const service = createService('payment', 'Payment', [
      ['api', 'compute'],
      ['worker', 'compute'],
    ]);

    const analyzed = analyzeScenario({
      graph,
      nodes,
      services: [service],
      scenario: createScenario('payment-spof', ['api'], 'node_failure'),
      drp: null,
      evidence: [],
    });

    expect(analyzed.impact?.totalAffectedNodes).toBe(2);
    expect(analyzed.impact?.cascadeAffected).toHaveLength(1);
  });
});

function createGraph(
  nodes: readonly InfraNodeAttrs[],
  edges: ReadonlyArray<{ readonly source: string; readonly target: string; readonly type: string }>,
): DirectedGraph<GraphRecord, GraphRecord> {
  const graph = new DirectedGraph<GraphRecord, GraphRecord>();
  for (const node of nodes) {
    graph.addNode(node.id, node as unknown as GraphRecord);
  }
  for (const edge of edges) {
    graph.addEdgeWithKey(`${edge.source}->${edge.target}:${edge.type}`, edge.source, edge.target, {
      type: edge.type,
    });
  }
  return graph;
}

function createScenario(
  id: string,
  affectedNodes: readonly string[],
  type: Scenario['type'],
): Scenario {
  return {
    id,
    name: id,
    description: id,
    type,
    disruption: {
      affectedNodes,
      selectionCriteria: id,
    },
  };
}

function createNode(
  id: string,
  type: string,
  region: string,
  availabilityZone: string,
  metadata: Record<string, unknown> = {},
): InfraNodeAttrs {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region,
    availabilityZone,
    tags: {},
    metadata,
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
