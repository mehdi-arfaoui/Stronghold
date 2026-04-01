import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DirectedGraph } from 'graphology';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  allValidationRules,
  analyzeFullGraph,
  calculateBlastRadius,
  deserializeDRPlan,
  transformToScanResult,
  generateDRPlan,
  generateRunbook,
  runValidation,
  serializeDRPlan,
  serializeRunbook,
  type DiscoveredResource,
  type GraphInstance,
  type InfraNode,
  type ScanEdge,
} from '../index.js';

interface PipelineFixture {
  readonly provider: string;
  readonly regions: readonly string[];
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<ScanEdge>;
}

interface AwsRealAggregateFixture {
  readonly results: {
    readonly provider: string;
    readonly regions: readonly string[];
  };
  readonly scannerFiles?: readonly string[];
}

interface AwsRealScannerFixture {
  readonly resources?: readonly DiscoveredResource[];
}

type GraphRecord = Record<string, unknown>;
type CoreGraph = DirectedGraph<GraphRecord, GraphRecord>;

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../__fixtures__');
const AWS_REAL_FIXTURE_DIR = path.join(FIXTURE_DIR, 'aws-real');
const DEMO_FIXTURE_NAMES = [
  'demo-startup.json',
  'demo-enterprise.json',
  'demo-minimal.json',
] as const;
const FIXED_GENERATED_AT = new Date('2026-03-27T00:00:00.000Z');

describe('pipeline integration', () => {
  for (const fixtureName of DEMO_FIXTURE_NAMES) {
    it(`${fixtureName} exercises the full core pipeline`, async () => {
      await exercisePipelineFixture(loadFixture(fixtureName));
    });
  }

  it('optionally exercises AWS-real fixtures when they are present', async (context) => {
    if (!fs.existsSync(AWS_REAL_FIXTURE_DIR)) {
      process.stdout.write('Skipping AWS-real integration fixtures: directory not found\n');
      context.skip();
    }

    await exercisePipelineFixture(loadAwsRealFixture());
  });
});

function loadFixture(fileName: string): PipelineFixture {
  const fixturePath = path.join(FIXTURE_DIR, fileName);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as PipelineFixture;
}

function loadAwsRealFixture(): PipelineFixture {
  const aggregatePath = path.join(AWS_REAL_FIXTURE_DIR, 'aggregate.json');
  const aggregate = JSON.parse(
    fs.readFileSync(aggregatePath, 'utf8'),
  ) as AwsRealAggregateFixture;
  const scannerFiles =
    aggregate.scannerFiles && aggregate.scannerFiles.length > 0
      ? [...aggregate.scannerFiles]
      : fs
          .readdirSync(AWS_REAL_FIXTURE_DIR, { recursive: true })
          .filter((entry) => typeof entry === 'string' && entry.endsWith('.json') && entry !== 'aggregate.json');
  const resources = scannerFiles.flatMap((relativePath) => {
    const scannerPath = path.join(AWS_REAL_FIXTURE_DIR, ...relativePath.split(/[\\/]/));
    const scannerFixture = JSON.parse(
      fs.readFileSync(scannerPath, 'utf8'),
    ) as AwsRealScannerFixture;
    return [...(scannerFixture.resources ?? [])];
  });

  if (resources.length === 0) {
    throw new Error('AWS-real fixture directory exists but no scanner resources were found.');
  }

  const transformed = transformToScanResult(resources, [], aggregate.results.provider);
  return {
    provider: aggregate.results.provider,
    regions: aggregate.results.regions,
    nodes: transformed.nodes as readonly InfraNode[],
    edges: transformed.edges,
  };
}

async function exercisePipelineFixture(fixture: PipelineFixture): Promise<void> {
  const startedAt = performance.now();
  const graph = buildGraph(fixture.nodes, fixture.edges);
  const analysis = await analyzeFullGraph(graph);
  const nodes = snapshotNodes(graph);
  const edges = snapshotEdges(graph);
  const blastRadius = calculateBlastRadius(nodes, edges);
  const validationReport = runValidation(nodes, edges, allValidationRules);
  const drPlan = generateDRPlan({
    graph,
    analysis,
    provider: fixture.provider,
    generatedAt: FIXED_GENERATED_AT,
  });
  const runbook = generateRunbook(drPlan, nodes);
  const drpYaml = serializeDRPlan(drPlan, 'yaml');
  const runbookYaml = serializeRunbook(runbook, 'yaml');
  const parsedDrp = deserializeDRPlan(drpYaml, 'yaml');
  const parsedRunbook = parseYaml(runbookYaml);
  const nodeIds = new Set(nodes.map((node) => node.id));

  expect(nodes).toHaveLength(fixture.nodes.length);
  expect(graph.order).toBe(fixture.nodes.length);
  expect(graph.size).toBeGreaterThan(0);
  expect(edges).not.toHaveLength(0);

  edges.forEach((edge) => {
    expect(nodeIds.has(edge.source)).toBe(true);
    expect(nodeIds.has(edge.target)).toBe(true);
  });

  expect(Number.isFinite(analysis.resilienceScore)).toBe(true);
  expect(analysis.resilienceScore).toBeGreaterThanOrEqual(0);
  expect(analysis.resilienceScore).toBeLessThanOrEqual(100);
  Array.from(analysis.criticalityScores.values()).forEach((score) => {
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  expect(blastRadius).not.toHaveLength(0);
  blastRadius.forEach((entry) => {
    expect(nodeIds.has(entry.nodeId)).toBe(true);
    expect(Number.isFinite(entry.impactRatio)).toBe(true);
    expect(entry.impactRatio).toBeGreaterThanOrEqual(0);
    expect(entry.impactRatio).toBeLessThanOrEqual(1);
    entry.impactedServices.forEach((serviceId) => {
      expect(nodeIds.has(serviceId)).toBe(true);
    });
  });

  expect(Number.isFinite(validationReport.score)).toBe(true);
  expect(Number.isFinite(validationReport.scoreBreakdown.overall)).toBe(true);
  expect(validationReport.scoreBreakdown.overall).toBeGreaterThanOrEqual(0);
  expect(validationReport.scoreBreakdown.overall).toBeLessThanOrEqual(100);
  Object.values(validationReport.scoreBreakdown.byCategory).forEach((score) => {
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  expect(parsedDrp.ok).toBe(true);
  expect(parsedRunbook).toBeTruthy();
  expect(runbook.componentRunbooks.length).toBeGreaterThan(0);

  drPlan.services.forEach((service) => {
    const componentIds = new Set(service.components.map((component) => component.resourceId));
    const recoveryOrder = new Set<string>();

    service.recoveryOrder.forEach((resourceId) => {
      expect(componentIds.has(resourceId)).toBe(true);
      expect(recoveryOrder.has(resourceId)).toBe(false);
      recoveryOrder.add(resourceId);
    });
  });

  runbook.componentRunbooks.forEach((componentRunbook) => {
    expect(componentRunbook.steps.length).toBeGreaterThan(0);
    componentRunbook.steps.forEach((step) => {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.description.trim().length).toBeGreaterThan(0);
      expect(step.command.description.trim().length).toBeGreaterThan(0);

      if ('command' in step.command) {
        expect(step.command.command.trim().length).toBeGreaterThan(0);
      }
      if ('consoleUrl' in step.command) {
        expect(step.command.consoleUrl.trim().length).toBeGreaterThan(0);
      }
      if ('scriptContent' in step.command) {
        expect(step.command.scriptContent.trim().length).toBeGreaterThan(0);
      }
    });
  });

  expect(performance.now() - startedAt).toBeGreaterThan(0);
}

function buildGraph(
  nodes: readonly InfraNode[],
  edges: ReadonlyArray<ScanEdge>,
): GraphInstance {
  const graph: CoreGraph = new DirectedGraph<GraphRecord, GraphRecord>();

  for (const node of nodes) {
    if (graph.hasNode(node.id)) {
      continue;
    }
    graph.addNode(node.id, node as unknown as GraphRecord);
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      continue;
    }

    const key = `${edge.source}->${edge.target}:${edge.type}`;
    if (graph.hasEdge(key)) {
      continue;
    }

    graph.addEdgeWithKey(key, edge.source, edge.target, {
      type: edge.type,
      confidence: typeof edge.confidence === 'number' ? edge.confidence : 1,
      confirmed: true,
      ...(edge.metadata ? { metadata: edge.metadata } : {}),
      ...(edge.inferenceMethod ? { inferenceMethod: edge.inferenceMethod } : {}),
    });
  }

  return graph as unknown as GraphInstance;
}

function snapshotNodes(graph: GraphInstance): readonly InfraNode[] {
  const nodes: InfraNode[] = [];
  graph.forEachNode((_nodeId, attrs) => {
    nodes.push(attrs as unknown as InfraNode);
  });
  return nodes.sort((left, right) => left.id.localeCompare(right.id));
}

function snapshotEdges(graph: GraphInstance): ReadonlyArray<ScanEdge> {
  const edges: ScanEdge[] = [];
  graph.forEachEdge((edgeKey, attrs, source, target) => {
    void edgeKey;
    edges.push({
      source,
      target,
      type: String(attrs.type ?? 'DEPENDS_ON'),
    });
  });
  return edges.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target) ||
      left.type.localeCompare(right.type),
  );
}
