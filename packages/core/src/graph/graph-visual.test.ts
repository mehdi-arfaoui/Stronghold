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
