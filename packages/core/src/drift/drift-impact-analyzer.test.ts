import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';
import { NodeType, type InfraNodeAttrs } from '../types/index.js';
import { analyzeDriftImpact } from './drift-impact-analyzer.js';
import type { DriftReport } from './drift-types.js';

type TestGraph = DirectedGraph<Record<string, unknown>, Record<string, unknown>>;

const FIXED_TIMESTAMP = new Date('2026-03-27T12:00:00.000Z');

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
    type: 'DEPENDS_ON',
    confidence: 1,
    confirmed: true,
  });
}

function makeReport(changes: DriftReport['changes']): DriftReport {
  return {
    scanIdBefore: 'before',
    scanIdAfter: 'after',
    timestamp: FIXED_TIMESTAMP,
    changes,
    summary: {
      total: changes.length,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      byCategory: {
        backup_changed: 0,
        redundancy_changed: 0,
        network_changed: 0,
        security_changed: 0,
        resource_added: 0,
        resource_removed: 0,
        config_changed: 0,
        dependency_changed: 0,
      },
      drpStale: false,
    },
  };
}

describe('analyzeDriftImpact', () => {
  it('attaches impacted critical services for a drifted dependency with many dependents', () => {
    const graph = createGraph();
    addNode(graph, makeNode({ id: 'db', name: 'orders-db', type: NodeType.DATABASE }));
    for (let index = 1; index <= 5; index++) {
      addNode(
        graph,
        makeNode({
          id: `svc-${index}`,
          name: `service-${index}`,
          type: NodeType.APPLICATION,
          criticalityScore: 85,
        }),
      );
      addDependency(graph, `svc-${index}`, 'db');
    }

    const report = analyzeDriftImpact(
      makeReport([
        {
          id: 'change-1',
          category: 'config_changed',
          severity: 'critical',
          resourceId: 'db',
          resourceType: NodeType.DATABASE,
          field: 'engineVersion',
          previousValue: '14.9',
          currentValue: '15.2',
          description: 'Engine version changed',
          drImpact: 'Potential incompatibility',
          affectedServices: [],
        },
      ]),
      graph,
    );

    expect(report.changes[0]?.affectedServices).toEqual([
      'service-1',
      'service-2',
      'service-3',
      'service-4',
      'service-5',
    ]);
    expect(report.summary.drpStale).toBe(true);
  });

  it('keeps low-impact drifts isolated when no critical dependents exist', () => {
    const graph = createGraph();
    addNode(graph, makeNode({ id: 'cache', name: 'cache', type: NodeType.CACHE }));

    const report = analyzeDriftImpact(
      makeReport([
        {
          id: 'change-1',
          category: 'config_changed',
          severity: 'medium',
          resourceId: 'cache',
          resourceType: NodeType.CACHE,
          field: 'nodeType',
          previousValue: 'cache.t3.small',
          currentValue: 'cache.t3.medium',
          description: 'Cache resized',
          drImpact: 'Capacity changed',
          affectedServices: [],
        },
      ]),
      graph,
    );

    expect(report.changes[0]?.affectedServices).toEqual([]);
    expect(report.summary.drpStale).toBe(false);
  });

  it('marks the DRP as stale when a backup-related drift touches a DRP component', () => {
    const graph = createGraph();
    addNode(graph, makeNode({ id: 'db', name: 'orders-db', type: NodeType.DATABASE }));

    const report = analyzeDriftImpact(
      makeReport([
        {
          id: 'change-1',
          category: 'backup_changed',
          severity: 'critical',
          resourceId: 'db',
          resourceType: NodeType.DATABASE,
          field: 'backupRetentionPeriod',
          previousValue: 7,
          currentValue: 0,
          description: 'Backups disabled',
          drImpact: 'Recovery point objective regressed',
          affectedServices: [],
        },
      ]),
      graph,
      { drpComponentIds: ['db'] },
    );

    expect(report.summary.drpStale).toBe(true);
  });

  it('returns an empty result unchanged when no drift exists', () => {
    const report = analyzeDriftImpact(makeReport([]), createGraph());

    expect(report.changes).toEqual([]);
    expect(report.summary.drpStale).toBe(false);
  });

  it('keeps missing referenced nodes visible when they are explicitly marked critical', () => {
    const report = analyzeDriftImpact(
      makeReport([
        {
          id: 'change-1',
          category: 'resource_removed',
          severity: 'high',
          resourceId: 'replica-missing',
          resourceType: NodeType.DATABASE,
          field: 'resource',
          previousValue: 'present',
          currentValue: 'missing',
          description: 'Replica missing from scan',
          drImpact: 'Cross-region failover uncertain',
          affectedServices: [],
        },
      ]),
      createGraph(),
      { criticalNodeIds: ['replica-missing'] },
    );

    expect(report.changes[0]?.affectedServices).toEqual(['replica-missing']);
    expect(report.summary.drpStale).toBe(true);
  });
});
