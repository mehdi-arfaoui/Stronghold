import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';

import { getStartupDemoPipelineInput } from '../demo/startup-demo.js';
import { generateDRPlan } from '../drp/drp-generator.js';
import { generateRecommendations } from '../recommendations/recommendation-engine.js';
import { analyzeBuiltInScenarios } from '../scenarios/scenario-engine.js';
import { calculateProofOfRecovery } from '../scoring/proof-of-recovery.js';
import { buildServicePosture } from '../services/service-posture-builder.js';
import type { GraphInstance } from './graph-instance.js';
import { analyzeFullGraph } from './graph-analysis-engine.js';
import { renderGraphHtml } from './graph-html-renderer.js';
import { buildGraphVisualData } from './graph-visual.js';
import type { GraphVisualData, GraphVisualSource } from './graph-visual-types.js';
import type { InfraNode, ScanEdge } from '../index.js';
import { allValidationRules, runValidation } from '../validation/index.js';

type GraphRecord = Record<string, unknown>;
type TestGraph = DirectedGraph<GraphRecord, GraphRecord>;

const FIXED_TIMESTAMP = '2026-03-27T00:00:00.000Z';

describe('renderGraphHtml', () => {
  it('renders a valid standalone html document with inline data', async () => {
    const html = renderGraphHtml(await createStartupVisualData());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<body>');
    expect(html).toContain('"globalScore"');
  });

  it('renders svg nodes, edges, clusters, and header metrics', async () => {
    const visual = await createStartupVisualData();
    const html = renderGraphHtml(visual);

    expect(html).toContain('<svg id="graph"');
    expect(html).toContain('<rect');
    expect(html).toContain('<path');
    expect(html).toContain('service-cluster');
    expect(html).toContain('<g class="node-icon"');
    expect(html).toContain(`${visual.globalScore}/100`);
  });

  it('includes the scenario selector options', async () => {
    const visual = await createStartupVisualData();
    const html = renderGraphHtml(visual);

    expect(html).toContain('id="scenario-select"');
    expect(html).toContain(visual.scenarios[0]?.name ?? '');
  });

  it('shows the redaction warning when node ids contain arns', () => {
    const html = renderGraphHtml(createArnVisualData());

    expect(html).toContain('Use --redact for sharing');
  });

  it('renders stronger cluster contrast and colored grade labels', () => {
    const html = renderGraphHtml(createArnVisualData());

    expect(html).toContain('rgba(234, 179, 8, 0.12)');
    expect(html).toContain('fill="#f97316"');
    expect(html).toContain('background:#0f1117');
    expect(html).toContain('background:#161822');
  });

  it('does not include emoji characters in the standalone html', async () => {
    const html = renderGraphHtml(await createStartupVisualData());

    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('keeps the startup demo export under 200KB', async () => {
    const html = renderGraphHtml(await createStartupVisualData());

    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(200 * 1024);
  });
});

async function createStartupVisualData(): Promise<GraphVisualData> {
  return buildGraphVisualData(await createStartupVisualSource());
}

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

function createArnVisualData(): GraphVisualData {
  return {
    nodes: [
      {
        id: 'arn:aws:rds:eu-west-1:123456789012:db:payments-primary',
        label: 'payments-primary',
        type: 'rds',
        serviceId: 'payments',
        serviceName: 'Payments',
        criticality: 'critical',
        drScore: 50,
        role: 'datastore',
        region: 'eu-west-1',
        az: 'eu-west-1a',
        x: 240,
        y: 160,
        findingCount: 1,
        worstSeverity: 'critical',
        findings: [],
        recommendations: [],
      },
    ],
    edges: [],
    services: [
      {
        id: 'payments',
        name: 'Payments',
        score: 42,
        grade: 'D',
        criticality: 'critical',
        findingCount: 1,
        worstSeverity: 'critical',
        nodeIds: ['arn:aws:rds:eu-west-1:123456789012:db:payments-primary'],
        x: 100,
        y: 90,
        width: 320,
        height: 180,
      },
    ],
    globalScore: 42,
    globalGrade: 'D',
    proofOfRecovery: 0,
    observedCoverage: 73,
    scanDate: FIXED_TIMESTAMP,
    scenarios: [],
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
