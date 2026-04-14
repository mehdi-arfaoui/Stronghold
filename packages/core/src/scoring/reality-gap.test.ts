import { DirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';

import { getStartupDemoPipelineInput } from '../demo/startup-demo.js';
import { generateDRPlan } from '../drp/drp-generator.js';
import { analyzeBuiltInScenarios } from '../scenarios/scenario-engine.js';
import { buildServicePosture } from '../services/service-posture-builder.js';
import type {
  DRPlan,
  InfraNode,
  ScanEdge,
  ScenarioAnalysis,
  Service,
  ServicePosture,
  ServicePostureService,
  ValidationReport,
  WeightedValidationResultWithEvidence,
} from '../index.js';
import type { GraphInstance } from '../graph/graph-instance.js';
import { analyzeFullGraph } from '../graph/graph-analysis-engine.js';
import { calculateRealityGap } from './reality-gap.js';
import { allValidationRules, runValidation } from '../validation/index.js';

type GraphRecord = Record<string, unknown>;
type TestGraph = DirectedGraph<GraphRecord, GraphRecord>;

describe('calculateRealityGap', () => {
  it('returns 0 claimed protection and no overall gap when no rules or services exist', () => {
    const result = calculateRealityGap({
      nodes: [],
      validationReport: createValidationReport([]),
      servicePosture: createPosture([]),
      scenarioAnalysis: createScenarioAnalysis([]),
      drpPlan: createDrpPlan([]),
    });

    expect(result.claimedProtection).toBe(0);
    expect(result.provenRecoverability).toBeNull();
    expect(result.realityGap).toBeNull();
    expect(result.perService).toEqual([]);
  });

  it('calculates claimed protection as the unweighted pass plus warn rate', () => {
    const rules = [
      ...Array.from({ length: 9 }, (_value, index) =>
        createRule(`node-${index}`, 'pass', 'tested'),
      ),
      createRule('node-fail', 'fail', 'observed'),
    ];

    const result = calculateRealityGap({
      nodes: [createNode('node-fail')],
      validationReport: createValidationReport(rules),
      servicePosture: createPosture([]),
      scenarioAnalysis: createScenarioAnalysis([]),
      drpPlan: createDrpPlan([]),
    });

    expect(result.claimedProtection).toBe(90);
  });

  it('returns 0 proven recoverability when no critical service is fully proven', () => {
    const services = [
      createServiceEntry('service-a', 'critical', ['db-a']),
      createServiceEntry('service-b', 'critical', ['db-b']),
      createServiceEntry('service-c', 'critical', ['db-c']),
    ];

    const result = calculateRealityGap({
      nodes: ['db-a', 'db-b', 'db-c'].map((nodeId) => createNode(nodeId)),
      validationReport: createValidationReport([
        createRule('db-a', 'pass', 'observed'),
        createRule('db-b', 'pass', 'observed'),
        createRule('db-c', 'pass', 'observed'),
      ]),
      servicePosture: createPosture(services),
      scenarioAnalysis: createScenarioAnalysis(
        services.map((service) => ({ serviceId: service.service.id, verdict: 'covered' as const })),
      ),
      drpPlan: createDrpPlan(services),
    });

    expect(result.provenRecoverability).toBe(0);
  });

  it('rounds to 33 when one of three critical services is fully proven', () => {
    const services = [
      createServiceEntry('service-a', 'critical', ['db-a']),
      createServiceEntry('service-b', 'critical', ['db-b']),
      createServiceEntry('service-c', 'critical', ['db-c']),
    ];

    const result = calculateRealityGap({
      nodes: ['db-a', 'db-b', 'db-c'].map((nodeId) => createNode(nodeId)),
      validationReport: createValidationReport([
        createRule('db-a', 'pass', 'tested'),
        createRule('db-b', 'pass', 'observed'),
        createRule('db-c', 'pass', 'observed'),
      ]),
      servicePosture: createPosture(services),
      scenarioAnalysis: createScenarioAnalysis(
        services.map((service) => ({ serviceId: service.service.id, verdict: 'covered' as const })),
      ),
      drpPlan: createDrpPlan(services),
    });

    expect(result.provenRecoverability).toBe(33);
  });

  it('marks a service as fully proven when evidence, scenarios, runbook, and topology checks all pass', () => {
    const service = createServiceEntry('service-a', 'critical', ['db-a']);

    const result = calculateRealityGap({
      nodes: [createNode('db-a')],
      validationReport: createValidationReport([createRule('db-a', 'pass', 'tested')]),
      servicePosture: createPosture([service]),
      scenarioAnalysis: createScenarioAnalysis([{ serviceId: 'service-a', verdict: 'covered' }]),
      drpPlan: createDrpPlan([service]),
    });

    expect(result.perService[0]?.provenRecoverability).toBe(100);
    expect(result.perService[0]?.gaps).toEqual([]);
  });

  it('flags broken runbooks when stale references are detected', () => {
    const service = createServiceEntry('service-a', 'critical', ['db-a']);

    const result = calculateRealityGap({
      nodes: [createNode('db-a')],
      validationReport: createValidationReport([createRule('db-a', 'pass', 'tested')]),
      servicePosture: createPosture([service]),
      scenarioAnalysis: createScenarioAnalysis([{ serviceId: 'service-a', verdict: 'covered' }]),
      drpPlan: createDrpPlan([service], {
        componentNameOverrides: {
          'db-a': 'db-a-dr',
        },
      }),
    });

    expect(result.perService[0]?.provenRecoverability).toBe(0);
    expect(result.perService[0]?.gaps).toContainEqual({
      type: 'runbook_broken',
      staleResources: ['db-a'],
    });
  });

  it('flags uncovered scenarios as a proven recoverability blocker', () => {
    const service = createServiceEntry('service-a', 'critical', ['db-a']);

    const result = calculateRealityGap({
      nodes: [createNode('db-a')],
      validationReport: createValidationReport([createRule('db-a', 'pass', 'tested')]),
      servicePosture: createPosture([service]),
      scenarioAnalysis: createScenarioAnalysis([{ serviceId: 'service-a', verdict: 'uncovered' }]),
      drpPlan: createDrpPlan([service]),
    });

    expect(result.perService[0]?.provenRecoverability).toBe(0);
    expect(result.perService[0]?.gaps).toContainEqual({
      type: 'scenario_uncovered',
      scenarioId: 'scenario-service-a',
      scenarioName: 'Scenario service-a',
    });
  });

  it('clamps the reality gap at zero when proof exceeds the naive claimed rate', () => {
    const service = createServiceEntry('service-a', 'critical', ['db-a']);

    const result = calculateRealityGap({
      nodes: [createNode('db-a')],
      validationReport: createValidationReport([
        createRule('db-a', 'pass', 'tested'),
        createRule('db-a', 'fail', 'observed'),
      ]),
      servicePosture: createPosture([service]),
      scenarioAnalysis: createScenarioAnalysis([{ serviceId: 'service-a', verdict: 'covered' }]),
      drpPlan: createDrpPlan([service]),
    });

    expect(result.claimedProtection).toBe(50);
    expect(result.provenRecoverability).toBe(100);
    expect(result.realityGap).toBe(0);
  });

  it('shows a reality gap above 50 on the startup demo', async () => {
    const result = await createStartupRealityGap();

    expect(result.realityGap).not.toBeNull();
    expect(result.realityGap ?? 0).toBeGreaterThan(50);
  });

  it('is deterministic for identical inputs', () => {
    const service = createServiceEntry('service-a', 'critical', ['db-a']);
    const input = {
      nodes: [createNode('db-a')],
      validationReport: createValidationReport([createRule('db-a', 'pass', 'tested')]),
      servicePosture: createPosture([service]),
      scenarioAnalysis: createScenarioAnalysis([{ serviceId: 'service-a', verdict: 'covered' }]),
      drpPlan: createDrpPlan([service]),
    };

    expect(calculateRealityGap(input)).toEqual(calculateRealityGap(input));
  });
});

async function createStartupRealityGap() {
  const demo = getStartupDemoPipelineInput();
  const graph = buildGraph(demo.nodes, demo.edges);
  const analysis = await analyzeFullGraph(graph);
  const nodes = snapshotNodes(graph);
  const validationReport = runValidation(nodes, demo.edges, allValidationRules, undefined, {
    timestamp: '2026-04-08T00:00:00.000Z',
  });
  const drpPlan = generateDRPlan({
    graph,
    analysis,
    provider: demo.provider,
    generatedAt: new Date('2026-04-08T00:00:00.000Z'),
  });
  const servicePosture = buildServicePosture({
    nodes,
    edges: demo.edges,
    validationReport,
    recommendations: [],
  });
  const scenarioAnalysis = analyzeBuiltInScenarios({
    graph,
    nodes,
    services: servicePosture.detection.services,
    analysis,
    drp: drpPlan,
    evidence: [],
  });

  return calculateRealityGap({
    nodes,
    validationReport,
    servicePosture,
    scenarioAnalysis,
    drpPlan,
  });
}

function createPosture(services: readonly ServicePostureService[]): ServicePosture {
  return {
    detection: {
      services: services.map((entry) => entry.service),
      unassignedResources: [],
      detectionSummary: {
        cloudformation: 0,
        tag: 0,
        topology: 0,
        manual: services.length,
        totalResources: services.reduce((sum, service) => sum + service.service.resources.length, 0),
        assignedResources: services.reduce((sum, service) => sum + service.service.resources.length, 0),
        unassignedResources: 0,
      },
    },
    scoring: {
      services: services.map((entry) => entry.score),
      unassigned: null,
    },
    contextualFindings: [],
    recommendations: [],
    services,
    unassigned: {
      score: null,
      resourceCount: 0,
      contextualFindings: [],
      recommendations: [],
    },
  };
}

function createServiceEntry(
  id: string,
  criticality: Service['criticality'],
  resourceIds: readonly string[],
): ServicePostureService {
  const service: Service = {
    id,
    name: id,
    criticality,
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1.0,
    },
    resources: resourceIds.map((resourceId) => ({
      nodeId: resourceId,
      role: 'datastore',
      detectionSource: {
        type: 'manual',
        file: '.stronghold/services.yml',
        confidence: 1.0,
      },
    })),
    metadata: {},
  };

  return {
    service,
    score: {
      serviceId: id,
      serviceName: id,
      resourceCount: resourceIds.length,
      criticality,
      detectionSource: service.detectionSource,
      score: 50,
      grade: 'D',
      findingsCount: {
        critical: 0,
        high: 0,
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

function createValidationReport(
  results: readonly WeightedValidationResultWithEvidence[],
): ValidationReport {
  return {
    timestamp: '2026-04-08T00:00:00.000Z',
    totalChecks: results.length,
    passed: results.filter((result) => result.status === 'pass').length,
    failed: results.filter((result) => result.status === 'fail').length,
    warnings: results.filter((result) => result.status === 'warn').length,
    skipped: results.filter((result) => result.status === 'skip').length,
    errors: results.filter((result) => result.status === 'error').length,
    results,
    score: 50,
    scoreBreakdown: {
      overall: 50,
      byCategory: {
        backup: 50,
        redundancy: 50,
        failover: 50,
        detection: 50,
        recovery: 50,
        replication: 50,
      },
      grade: 'D',
      weakestCategory: 'backup',
      scoringMethod: 'test',
      disclaimer: 'test',
    },
    criticalFailures: results.filter((result) => result.severity === 'critical'),
    scannedResources: results.length,
  };
}

function createRule(
  nodeId: string,
  status: WeightedValidationResultWithEvidence['status'],
  evidenceType: WeightedValidationResultWithEvidence['weightBreakdown']['evidenceType'],
): WeightedValidationResultWithEvidence {
  return {
    ruleId: `backup-${status}-${nodeId}-${evidenceType}`,
    nodeId,
    nodeName: nodeId,
    nodeType: 'DATABASE',
    status,
    severity: 'medium',
    category: 'backup',
    weight: 1,
    message: `${nodeId} ${status}`,
    evidence: [
      {
        id: `${nodeId}-${status}-${evidenceType}`,
        type: evidenceType,
        source:
          evidenceType === 'tested' || evidenceType === 'expired'
            ? {
                origin: 'test',
                testType: 'restore-test',
                testDate: '2026-04-08T00:00:00.000Z',
              }
            : {
                origin: 'scan',
                scanTimestamp: '2026-04-08T00:00:00.000Z',
              },
        subject: {
          nodeId,
          ruleId: `backup-${status}-${nodeId}-${evidenceType}`,
        },
        observation: {
          key: 'backupRetentionPeriod',
          value: evidenceType,
          expected: '> 0',
          description: `${evidenceType} evidence`,
        },
        timestamp: '2026-04-08T00:00:00.000Z',
        ...(evidenceType === 'expired' ? { expiresAt: '2026-04-01T00:00:00.000Z' } : {}),
      },
    ],
    weightBreakdown: {
      severityWeight: 1,
      criticalityWeight: 1,
      blastRadiusWeight: 1,
      directDependentCount: 0,
      evidenceType,
      evidenceConfidence: {
        observed: 0.85,
        inferred: 0.5,
        declared: 0.7,
        tested: 1.0,
        expired: 0.2,
      }[evidenceType],
    },
  };
}

function createScenarioAnalysis(
  services: ReadonlyArray<{
    readonly serviceId: string;
    readonly verdict: 'covered' | 'partially_covered' | 'uncovered' | 'degraded';
  }>,
): ScenarioAnalysis {
  return {
    scenarios: services.map((service) => ({
      id: `scenario-${service.serviceId}`,
      name: `Scenario ${service.serviceId}`,
      description: 'test',
      type: 'region_failure',
      disruption: {
        affectedNodes: [`${service.serviceId}-node`],
        selectionCriteria: 'test',
      },
      impact: {
        directlyAffected: [],
        cascadeAffected: [],
        totalAffectedNodes: 0,
        totalAffectedServices: [service.serviceId],
        serviceImpact: [
          {
            serviceId: service.serviceId,
            serviceName: service.serviceId,
            affectedResources: 1,
            totalResources: 1,
            percentageAffected: 100,
            criticalResourcesAffected: [],
            status: 'down',
          },
        ],
      },
      coverage: {
        verdict: service.verdict,
        details: [
          {
            serviceId: service.serviceId,
            serviceName: service.serviceId,
            verdict: service.verdict,
            reason: service.verdict === 'covered' ? 'Covered.' : 'Uncovered.',
            missingCapabilities: [],
            evidenceLevel: service.verdict === 'covered' ? 'tested' : 'observed',
          },
        ],
        summary: service.verdict,
      },
    })),
    defaultScenarioIds: services.map((service) => `scenario-${service.serviceId}`),
    summary: {
      total: services.length,
      covered: services.filter((service) => service.verdict === 'covered').length,
      partiallyCovered: services.filter((service) => service.verdict === 'partially_covered').length,
      uncovered: services.filter((service) => service.verdict === 'uncovered').length,
      degraded: services.filter((service) => service.verdict === 'degraded').length,
    },
  };
}

function createDrpPlan(
  services: readonly ServicePostureService[],
  overrides: {
    readonly componentNameOverrides?: Readonly<Record<string, string>>;
  } = {},
): DRPlan {
  return {
    id: 'drp-test',
    version: '1.0.0',
    generated: '2026-04-08T00:00:00.000Z',
    infrastructureHash: 'hash',
    provider: 'aws',
    regions: ['eu-west-1'],
    services: services.map((service) => ({
      name: service.service.name,
      criticality: service.service.criticality,
      rtoTarget: '4h',
      rpoTarget: '1h',
      components: service.service.resources.map((resource) => ({
        resourceId: resource.nodeId,
        resourceType: 'DATABASE',
        name: overrides.componentNameOverrides?.[resource.nodeId] ?? resource.nodeId,
        region: 'eu-west-1',
        recoveryStrategy: 'restore_from_backup',
        recoverySteps: [],
        estimatedRTO: '1h',
        estimatedRPO: '15m',
        dependencies: [],
        risks: [],
      })),
      validationTests: [],
      estimatedRTO: '1h',
      estimatedRPO: '15m',
      recoveryOrder: service.service.resources.map((resource) => resource.nodeId),
    })),
    metadata: {
      totalResources: services.reduce((sum, service) => sum + service.service.resources.length, 0),
      coveredResources: services.reduce((sum, service) => sum + service.service.resources.length, 0),
      uncoveredResources: [],
      worstCaseRTO: '4h',
      averageRPO: '1h',
      stale: false,
    },
  };
}

function createNode(nodeId: string): InfraNode {
  return {
    id: nodeId,
    name: nodeId,
    type: 'database',
    provider: 'aws',
    region: 'eu-west-1',
    availabilityZone: 'eu-west-1a',
    tags: {},
    metadata: {},
    blastRadius: 0,
    isSPOF: false,
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
