import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';

import { generateDRPlan } from '../../drp/index.js';
import { analyzeFullGraph } from '../graph-analysis-engine.js';
import type { GraphInstance } from '../graph-instance.js';
import { EdgeType, NodeType, type InfraNodeAttrs, type ScanEdge } from '../../types/index.js';
import { applyGraphOverrides } from './applier.js';
import {
  GraphOverrideValidationError,
  loadGraphOverrides,
  parseGraphOverrides,
  renderGraphOverridesTemplate,
} from './loader.js';

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

function buildGraph(nodes: readonly InfraNodeAttrs[], edges: readonly ScanEdge[]) {
  const graph = new DirectedGraph<Record<string, unknown>, Record<string, unknown>>();

  for (const node of nodes) {
    graph.addNode(node.id, node as unknown as Record<string, unknown>);
  }

  for (const edge of edges) {
    graph.addEdgeWithKey(`${edge.source}->${edge.target}:${edge.type}`, edge.source, edge.target, {
      type: edge.type,
      confidence: edge.confidence ?? 1,
      confirmed: true,
      ...(edge.provenance ? { provenance: edge.provenance } : {}),
      ...(edge.reason ? { reason: edge.reason } : {}),
      ...(edge.metadata ? { metadata: edge.metadata } : {}),
      ...(edge.inferenceMethod ? { inferenceMethod: edge.inferenceMethod } : {}),
    });
  }

  return graph;
}

describe('graph overrides loader', () => {
  it('loads a valid overrides file', () => {
    const overrides = parseGraphOverrides(`
version: 1
add_edges:
  - source: api
    target: db
    type: DEPENDS_ON
    reason: api depends on db
remove_edges:
  - source: old
    target: queue
    type: ROUTES_TO
    reason: stale edge
criticality_overrides:
  - node: db
    score: 95
    reason: database is business critical
`);

    expect(overrides.add_edges).toHaveLength(1);
    expect(overrides.remove_edges).toHaveLength(1);
    expect(overrides.criticality_overrides).toHaveLength(1);
  });

  it('returns null when the overrides file does not exist', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-overrides-'));
    const missingPath = path.join(directory, 'missing.yml');

    expect(loadGraphOverrides(missingPath)).toBeNull();
  });

  it('rejects invalid yaml shape', () => {
    expect(() => parseGraphOverrides('version: wrong')).toThrow(GraphOverrideValidationError);
  });

  it('rejects missing reasons', () => {
    expect(() =>
      parseGraphOverrides(`
version: 1
add_edges:
  - source: api
    target: db
    type: DEPENDS_ON
criticality_overrides: []
remove_edges: []
`),
    ).toThrow(/reason is required/);
  });

  it('renders a commented template', () => {
    const template = renderGraphOverridesTemplate();

    expect(template).toContain('version: 1');
    expect(template).toContain('add_edges:');
    expect(template).toContain('criticality_overrides:');
  });
});

describe('graph overrides applier', () => {
  const baseNodes = [
    makeNode({ id: 'api', name: 'api', type: NodeType.APPLICATION }),
    makeNode({ id: 'db', name: 'db', type: NodeType.DATABASE }),
    makeNode({ id: 'queue', name: 'queue', type: NodeType.MESSAGE_QUEUE }),
  ];

  it('adds a manual edge', () => {
    const result = applyGraphOverrides(baseNodes, [], {
      version: 1,
      add_edges: [{ source: 'api', target: 'db', type: EdgeType.DEPENDS_ON, reason: 'api uses db' }],
      remove_edges: [],
      criticality_overrides: [],
    });

    expect(result.edges).toEqual([
      expect.objectContaining({
        source: 'api',
        target: 'db',
        type: EdgeType.DEPENDS_ON,
        provenance: 'manual',
        reason: 'api uses db',
      }),
    ]);
  });

  it('removes an edge when requested', () => {
    const result = applyGraphOverrides(
      baseNodes,
      [
        {
          source: 'api',
          target: 'queue',
          type: EdgeType.PUBLISHES_TO,
          provenance: 'inferred',
        },
      ],
      {
        version: 1,
        add_edges: [],
        remove_edges: [
          {
            source: 'api',
            target: 'queue',
            type: EdgeType.PUBLISHES_TO,
            reason: 'queue is no longer a dependency',
          },
        ],
        criticality_overrides: [],
      },
    );

    expect(result.edges).toEqual([]);
  });

  it('applies a manual criticality override', () => {
    const result = applyGraphOverrides(baseNodes, [], {
      version: 1,
      add_edges: [],
      remove_edges: [],
      criticality_overrides: [
        {
          node: 'db',
          score: 92,
          reason: 'database is mission critical',
        },
      ],
    });

    expect(result.nodes.find((node) => node.id === 'db')).toEqual(
      expect.objectContaining({
        criticalityScore: 92,
        criticalitySource: 'manual',
        criticalityOverrideReason: 'database is mission critical',
      }),
    );
  });

  it('warns when references are missing', () => {
    const result = applyGraphOverrides(baseNodes, [], {
      version: 1,
      add_edges: [{ source: 'api', target: 'missing', type: EdgeType.DEPENDS_ON, reason: 'missing target' }],
      remove_edges: [{ source: 'api', target: 'queue', type: EdgeType.PUBLISHES_TO, reason: 'missing edge' }],
      criticality_overrides: [{ node: 'missing', score: 88, reason: 'missing node' }],
    });

    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'missing_node',
      'missing_edge',
      'missing_criticality_target',
    ]);
  });

  it('changes downstream analysis and drp output when criticality is overridden', async () => {
    const nodes = [
      makeNode({ id: 'app', name: 'app', type: NodeType.APPLICATION }),
      makeNode({ id: 'bucket', name: 'bucket', type: NodeType.OBJECT_STORAGE }),
    ];
    const edges: ScanEdge[] = [
      {
        source: 'app',
        target: 'bucket',
        type: EdgeType.DEPENDS_ON,
        provenance: 'aws-api',
      },
    ];

    const baselineGraph = buildGraph(nodes, edges);
    const baselineAnalysis = await analyzeFullGraph(baselineGraph as unknown as GraphInstance);
    const baselinePlan = generateDRPlan({
      graph: baselineGraph as unknown as GraphInstance,
      analysis: baselineAnalysis,
      provider: 'aws',
      generatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    const overridden = applyGraphOverrides(nodes, edges, {
      version: 1,
      add_edges: [],
      remove_edges: [],
      criticality_overrides: [
        {
          node: 'bucket',
          score: 95,
          reason: 'bucket stores the recovery source of truth',
        },
      ],
    });
    const overriddenGraph = buildGraph(overridden.nodes, overridden.edges);
    const overriddenAnalysis = await analyzeFullGraph(overriddenGraph as unknown as GraphInstance);
    const overriddenPlan = generateDRPlan({
      graph: overriddenGraph as unknown as GraphInstance,
      analysis: overriddenAnalysis,
      provider: 'aws',
      generatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    expect((baselineAnalysis.criticalityScores.get('bucket') ?? 0)).toBeLessThan(95);
    expect(overriddenAnalysis.criticalityScores.get('bucket')).toBe(95);
    expect(baselinePlan.services.find((service) => service.name === 'bucket')?.criticality).not.toBe(
      'critical',
    );
    expect(overriddenPlan.services.find((service) => service.name === 'bucket')?.criticality).toBe(
      'critical',
    );
  });
});
