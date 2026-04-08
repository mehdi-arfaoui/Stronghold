import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';

import { propagateImpact } from '../impact-propagator.js';
import type { Service } from '../../services/service-types.js';
import type { InfraNodeAttrs } from '../../types/infrastructure.js';

type GraphRecord = Record<string, unknown>;
type ResourceRoleSpec = NonNullable<Service['resources'][number]['role']>;
type ResourceSpec = readonly [string, ResourceRoleSpec];

describe('propagateImpact', () => {
  it('marks a dependent as cascade-affected at depth 1', () => {
    const graph = createGraph(
      [createNode('api', 'VM'), createNode('db', 'DATABASE')],
      [{ source: 'api', target: 'db', type: 'depends_on' }],
    );

    const impact = propagateImpact(graph, ['db'], [
      createService('payment', 'Payment', [
        ['api', 'compute'],
        ['db', 'datastore'],
      ]),
    ]);

    expect(impact.directlyAffected.map((node) => node.nodeId)).toEqual(['db']);
    expect(impact.cascadeAffected).toEqual([
      expect.objectContaining({
        nodeId: 'api',
        cascadeDepth: 1,
        impactType: 'cascade',
      }),
    ]);
  });

  it('walks a dependency chain in reverse order', () => {
    const graph = createGraph(
      [createNode('api', 'VM'), createNode('worker', 'VM'), createNode('db', 'DATABASE')],
      [
        { source: 'api', target: 'worker', type: 'depends_on' },
        { source: 'worker', target: 'db', type: 'depends_on' },
      ],
    );

    const impact = propagateImpact(graph, ['db'], [
      createService('payment', 'Payment', [
        ['api', 'compute'],
        ['worker', 'compute'],
        ['db', 'datastore'],
      ]),
    ]);

    expect(impact.cascadeAffected.map((node) => [node.nodeId, node.cascadeDepth])).toEqual([
      ['worker', 1],
      ['api', 2],
    ]);
  });

  it('ignores infrastructure-only edges during propagation', () => {
    const graph = createGraph(
      [createNode('api', 'VM'), createNode('security-group', 'FIREWALL')],
      [{ source: 'api', target: 'security-group', type: 'secured_by' }],
    );

    const impact = propagateImpact(graph, ['security-group'], [
      createService('payment', 'Payment', [['api', 'compute']]),
    ]);

    expect(impact.cascadeAffected).toHaveLength(0);
  });

  it('caps cascade depth at 10', () => {
    const nodes = Array.from({ length: 12 }, (_, index) =>
      createNode(`node-${index + 1}`, index === 11 ? 'DATABASE' : 'VM'),
    );
    const edges = Array.from({ length: 11 }, (_, index) => ({
      source: `node-${index + 1}`,
      target: `node-${index + 2}`,
      type: 'depends_on',
    }));
    const resources = nodes.map((node) => [node.id, node.type === 'DATABASE' ? 'datastore' : 'compute'] as const);
    const graph = createGraph(nodes, edges);

    const impact = propagateImpact(graph, ['node-12'], [createService('chain', 'Chain', resources)]);

    expect(impact.cascadeAffected.some((node) => node.nodeId === 'node-1')).toBe(false);
    expect(impact.cascadeAffected.some((node) => node.nodeId === 'node-2')).toBe(true);
  });

  it('classifies a service as down when a datastore is affected', () => {
    const graph = createGraph([createNode('db', 'DATABASE')], []);

    const impact = propagateImpact(graph, ['db'], [
      createService('payment', 'Payment', [['db', 'datastore']]),
    ]);

    expect(impact.serviceImpact[0]).toMatchObject({
      serviceId: 'payment',
      status: 'down',
      criticalResourcesAffected: ['db'],
    });
  });

  it('classifies a service as degraded when only monitoring resources are affected', () => {
    const graph = createGraph([createNode('alarm', 'MONITORING'), createNode('api', 'VM')], []);

    const impact = propagateImpact(graph, ['alarm'], [
      createService('payment', 'Payment', [
        ['alarm', 'monitoring'],
        ['api', 'compute'],
      ]),
    ]);

    expect(impact.serviceImpact[0]).toMatchObject({
      serviceId: 'payment',
      status: 'degraded',
    });
  });

  it('keeps unaffected services marked as unaffected', () => {
    const graph = createGraph([createNode('db', 'DATABASE')], []);

    const impact = propagateImpact(graph, ['db'], [
      createService('payment', 'Payment', [['db', 'datastore']]),
      createService('auth', 'Auth', [['auth-api', 'compute']]),
    ]);

    expect(impact.serviceImpact.find((service) => service.serviceId === 'auth')).toMatchObject({
      serviceId: 'auth',
      status: 'unaffected',
    });
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

function createNode(id: string, type: string): InfraNodeAttrs {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region: 'eu-west-3',
    availabilityZone: 'eu-west-3a',
    tags: {},
    metadata: {},
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
