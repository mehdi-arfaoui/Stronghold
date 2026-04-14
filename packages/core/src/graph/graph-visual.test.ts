import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';

import { getStartupDemoPipelineInput } from '../demo/startup-demo.js';
import { generateDRPlan } from '../drp/drp-generator.js';
import { analyzeBuiltInScenarios } from '../scenarios/scenario-engine.js';
import { calculateProofOfRecovery } from '../scoring/proof-of-recovery.js';
import { buildServicePosture } from '../services/service-posture-builder.js';
import { generateRecommendations } from '../recommendations/recommendation-engine.js';
import type { GraphInstance } from './graph-instance.js';
import { analyzeFullGraph } from './graph-analysis-engine.js';
import { buildGraphVisualData } from './graph-visual.js';
import type { GraphVisualSource } from './graph-visual-types.js';
import type { InfraNode, ScanEdge } from '../index.js';
import { allValidationRules, runValidation } from '../validation/index.js';

type GraphRecord = Record<string, unknown>;
type TestGraph = DirectedGraph<GraphRecord, GraphRecord>;

const FIXED_TIMESTAMP = '2026-03-27T00:00:00.000Z';

describe('buildGraphVisualData', () => {
  it('returns empty collections for an empty scan', () => {
    const visual = buildGraphVisualData({
      provider: 'aws',
      nodes: [],
      edges: [],
      scannedAt: new Date(FIXED_TIMESTAMP),
    });

    expect(visual.nodes).toEqual([]);
    expect(visual.edges).toEqual([]);
    expect(visual.services).toEqual([]);
    expect(visual.scenarios).toEqual([]);
  });

  it('builds visual data for the startup demo pipeline', async () => {
    const source = await createStartupVisualSource();
    const visual = buildGraphVisualData(source);

    expect(visual.nodes).toHaveLength(24);
    expect(visual.edges.length).toBeGreaterThan(0);
    expect(visual.edges.length).toBeLessThan(source.edges.length);
    expect(visual.services.length).toBeGreaterThan(0);
    expect(visual.scenarios.length).toBeGreaterThan(0);
    expect(visual.edges.some((edge) => ['contains', 'member_of', 'secured_by'].includes(edge.label))).toBe(false);
  });

  it('assigns valid coordinates and service bounds', async () => {
    const visual = buildGraphVisualData(await createStartupVisualSource());

    visual.nodes.forEach((node) => {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
    });

    visual.services.forEach((service) => {
      expect(service.width).toBeGreaterThan(0);
      expect(service.height).toBeGreaterThan(0);
      expect(service.x).toBeGreaterThanOrEqual(0);
      expect(service.y).toBeGreaterThanOrEqual(0);
    });
  });

  it('packs service bounds so they do not overlap and keeps compact header room above nodes', async () => {
    const visual = buildGraphVisualData(await createStartupVisualSource());

    visual.services.forEach((service) => {
      const nodeTops = service.nodeIds
        .map((nodeId) => visual.nodes.find((node) => node.id === nodeId))
        .filter((node): node is (typeof visual.nodes)[number] => node !== undefined)
        .map((node) => node.y - 34);
      const firstNodeTop = Math.min(...nodeTops);

      expect(firstNodeTop - service.y).toBeGreaterThanOrEqual(24);
    });

    for (let index = 0; index < visual.services.length; index += 1) {
      const left = visual.services[index];
      if (!left) {
        continue;
      }

      for (let compareIndex = index + 1; compareIndex < visual.services.length; compareIndex += 1) {
        const right = visual.services[compareIndex];
        if (!right) {
          continue;
        }

        const overlapX = Math.max(
          0,
          Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
        );
        const overlapY = Math.max(
          0,
          Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
        );

        expect(overlapX === 0 || overlapY === 0).toBe(true);
      }
    }
  });

  it('keeps single-node service clusters materially smaller than multi-node clusters', () => {
    const visual = buildGraphVisualData(createServiceClusterSizingSource());
    const service11 = visual.services.find((service) => service.id === 'service-11');
    const service12 = visual.services.find((service) => service.id === 'service-12');

    expect(service11).toBeDefined();
    expect(service12).toBeDefined();
    expect(service11?.width).toBe(240);
    expect(service11?.height).toBe(136);
    expect(service12?.width).toBeGreaterThan(service11?.width ?? 0);
    expect(service12?.height).toBeGreaterThan(service11?.height ?? 0);
    expect((service12?.width ?? 0) / (service11?.width ?? 1)).toBeGreaterThanOrEqual(1.5);
  });

  it('leaves unassigned resources without a service id', () => {
    const visual = buildGraphVisualData({
      provider: 'aws',
      nodes: [createNode('orphan-node', 'orphan-node', 'VM')],
      edges: [],
      scannedAt: new Date(FIXED_TIMESTAMP),
    });

    expect(visual.nodes[0]?.serviceId).toBeNull();
  });

  it('preserves edge provenance metadata', () => {
    const visual = buildGraphVisualData({
      provider: 'aws',
      nodes: [createNode('source', 'source', 'VM'), createNode('target', 'target', 'DATABASE')],
      edges: [
        { source: 'source', target: 'target', type: 'DEPENDS_ON', provenance: 'manual' },
        { source: 'target', target: 'source', type: 'TRIGGERS', provenance: 'inferred' },
      ],
      scannedAt: new Date(FIXED_TIMESTAMP),
    });

    expect(visual.edges).toEqual([
      {
        source: 'source',
        target: 'target',
        label: 'depends_on',
        provenance: 'manual',
      },
      {
        source: 'target',
        target: 'source',
        label: 'triggers',
        provenance: 'inferred',
      },
    ]);
  });

  it('filters structural edges but keeps nodes that become isolated', () => {
    const visual = buildGraphVisualData({
      provider: 'aws',
      nodes: [createNode('service-a', 'service-a', 'VM'), createNode('service-b', 'service-b', 'VM')],
      edges: [{ source: 'service-a', target: 'service-b', type: 'CONTAINS', provenance: 'aws-api' }],
      scannedAt: new Date(FIXED_TIMESTAMP),
    });

    expect(visual.nodes).toHaveLength(2);
    expect(visual.edges).toEqual([]);
  });

  it('collects affected node ids for scenarios', async () => {
    const source = await createStartupVisualSource();
    const visual = buildGraphVisualData(source);
    const originalScenario = source.scenarioAnalysis?.scenarios[0];
    const visualScenario = visual.scenarios.find(
      (scenario) => scenario.id === originalScenario?.id,
    );

    expect(visualScenario).toBeDefined();
    expect(visualScenario?.affectedNodeIds).toEqual(
      Array.from(
        new Set([
          ...(originalScenario?.impact?.directlyAffected.map((item) => item.nodeId) ?? []),
          ...(originalScenario?.impact?.cascadeAffected.map((item) => item.nodeId) ?? []),
        ]),
      ).sort((left, right) => left.localeCompare(right)),
    );
  });
});

async function createStartupVisualSource(): Promise<GraphVisualSource> {
  const demo = getStartupDemoPipelineInput();
  const graph = buildGraph(demo.nodes, demo.edges);
  const analysis = await analyzeFullGraph(graph);
  const nodes = snapshotNodes(graph);
  const validationReport = runValidation(nodes, demo.edges, allValidationRules, undefined, {
    timestamp: FIXED_TIMESTAMP,
  });
  const drpPlan = generateDRPlan({
    graph,
    analysis,
    provider: demo.provider,
    generatedAt: new Date(FIXED_TIMESTAMP),
  });
  const recommendations = generateRecommendations({
    nodes,
    validationReport,
    drpPlan,
    isDemo: true,
  });
  const servicePosture = buildServicePosture({
    nodes,
    edges: demo.edges,
    validationReport,
    recommendations,
  });
  const scenarioAnalysis = analyzeBuiltInScenarios({
    graph,
    nodes,
    services: servicePosture.detection.services,
    analysis,
    drp: drpPlan,
    evidence: [],
  });

  return {
    provider: demo.provider,
    nodes,
    edges: demo.edges,
    timestamp: FIXED_TIMESTAMP,
    validationReport,
    proofOfRecovery: calculateProofOfRecovery({
      validationReport,
      servicePosture,
    }),
    servicePosture,
    scenarioAnalysis,
  };
}

function buildGraph(nodes: readonly InfraNode[], edges: ReadonlyArray<ScanEdge>): GraphInstance {
  const graph: TestGraph = new DirectedGraph<GraphRecord, GraphRecord>();

  nodes.forEach((node) => {
    graph.addNode(node.id, node as unknown as GraphRecord);
  });
  edges.forEach((edge) => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      return;
    }
    graph.addEdgeWithKey(`${edge.source}->${edge.target}:${edge.type}`, edge.source, edge.target, {
      type: edge.type,
      confidence: edge.confidence ?? 1,
      confirmed: true,
      ...(edge.provenance ? { provenance: edge.provenance } : {}),
    });
  });

  return graph as unknown as GraphInstance;
}

function snapshotNodes(graph: GraphInstance): readonly InfraNode[] {
  const nodes: InfraNode[] = [];
  graph.forEachNode((_nodeId, attrs) => {
    nodes.push(attrs as unknown as InfraNode);
  });
  return nodes;
}

function createNode(id: string, name: string, type: string): InfraNode {
  return {
    id,
    name,
    type,
    provider: 'aws',
    region: 'eu-west-1',
    availabilityZone: null,
    tags: {},
    metadata: {},
  };
}

function createServiceClusterSizingSource(): GraphVisualSource {
  const nodes = [
    createNode('service-11-db', 'service-11-db', 'DATABASE'),
    createNode('service-12-api', 'service-12-api', 'VM'),
    createNode('service-12-worker', 'service-12-worker', 'VM'),
    createNode('service-12-db', 'service-12-db', 'DATABASE'),
  ];
  const edges: readonly ScanEdge[] = [
    { source: 'service-12-api', target: 'service-12-db', type: 'DEPENDS_ON', provenance: 'aws-api' },
    { source: 'service-12-worker', target: 'service-12-db', type: 'DEPENDS_ON', provenance: 'aws-api' },
  ];

  return {
    provider: 'aws',
    nodes,
    edges,
    scannedAt: new Date(FIXED_TIMESTAMP),
    servicePosture: {
      detection: {
        services: [
          createServiceDefinition('service-11', ['service-11-db'], 'Service 11'),
          createServiceDefinition('service-12', ['service-12-api', 'service-12-worker', 'service-12-db'], 'Service 12'),
        ],
        unassignedResources: [],
        detectionSummary: {
          cloudformation: 0,
          tag: 0,
          topology: 0,
          manual: 2,
          totalResources: 4,
          assignedResources: 4,
          unassignedResources: 0,
        },
      },
      scoring: {
        services: [],
        unassigned: null,
      },
      contextualFindings: [],
      recommendations: [],
      services: [
        createServicePostureEntry('service-11', 'Service 11', ['service-11-db'], 52, 'D'),
        createServicePostureEntry(
          'service-12',
          'Service 12',
          ['service-12-api', 'service-12-worker', 'service-12-db'],
          85,
          'B',
        ),
      ],
      unassigned: {
        score: null,
        resourceCount: 0,
        contextualFindings: [],
        recommendations: [],
      },
    },
  };
}

function createServiceDefinition(
  id: string,
  nodeIds: readonly string[],
  name: string,
) {
  return {
    id,
    name,
    criticality: 'high' as const,
    detectionSource: {
      type: 'manual' as const,
      file: '.stronghold/services.yml',
      confidence: 1.0 as const,
    },
    resources: nodeIds.map((nodeId) => ({
      nodeId,
      role: nodeId.endsWith('db') ? ('datastore' as const) : ('compute' as const),
      detectionSource: {
        type: 'manual' as const,
        file: '.stronghold/services.yml',
        confidence: 1.0 as const,
      },
    })),
    metadata: {},
  };
}

function createServicePostureEntry(
  id: string,
  name: string,
  nodeIds: readonly string[],
  score: number,
  grade: 'A' | 'B' | 'C' | 'D' | 'F',
) {
  const service = createServiceDefinition(id, nodeIds, name);

  return {
    service,
    score: {
      serviceId: id,
      serviceName: name,
      resourceCount: nodeIds.length,
      criticality: service.criticality,
      detectionSource: service.detectionSource,
      score,
      grade,
      findingsCount: {
        critical: 0,
        high: grade === 'D' ? 1 : 0,
        medium: 0,
        low: 0,
      },
      findings: [],
      coverageGaps: [],
    },
    contextualFindings: [],
    recommendations: [],
  };
}
