import { describe, expect, it } from 'vitest';

import { calculateRealityGap, type ReasoningScanResult, type Service, type ServicePosture, type ServicePostureService, type ValidationReport, type WeightedValidationResultWithEvidence } from '../index.js';
import { buildReasoningChain } from './reasoning-engine.js';

describe('buildReasoningChain', () => {
  it('builds a compact positive chain when the service is fully covered', () => {
    const service = createServiceEntry('payment', 'critical', ['payment-db']);
    const scan = createScanResult({
      services: [service],
      nodes: [createNode('payment-db')],
      edges: [],
      results: [createRule('payment-db', 'backup-plan', 'pass', 'medium', 'backup', 'tested')],
      scenarios: [createScenario('payment', 'covered')],
      drpPlan: createDrpPlan([service]),
    });
    const chain = buildReasoningChain(
      'payment',
      scan,
      null,
      null,
      calculateRealityGap({
        nodes: scan.nodes,
        validationReport: scan.validationReport,
        servicePosture: scan.servicePosture,
        scenarioAnalysis: scan.scenarioAnalysis,
        drpPlan: scan.drpPlan,
      }),
    );

    expect(chain.steps.some((step) => step.type === 'positive')).toBe(true);
    expect(chain.conclusion).toContain('fully proven recoverable');
  });

  it('includes finding and evidence gap steps when critical issues remain without tests', () => {
    const service = createServiceEntry('database', 'critical', ['prod-db-primary']);
    const scan = createScanResult({
      services: [service],
      nodes: [createNode('prod-db-primary', { blastRadius: 4, isSPOF: true, dependentsCount: 3 })],
      edges: [],
      results: [
        createRule('prod-db-primary', 'backup-plan', 'fail', 'critical', 'backup', 'observed'),
        createRule('prod-db-primary', 'retention', 'fail', 'high', 'backup', 'observed'),
      ],
      scenarios: [createScenario('database', 'uncovered')],
      drpPlan: createDrpPlan([service]),
    });
    const chain = buildReasoningChain(
      'database',
      scan,
      null,
      null,
      calculateRealityGap({
        nodes: scan.nodes,
        validationReport: scan.validationReport,
        servicePosture: scan.servicePosture,
        scenarioAnalysis: scan.scenarioAnalysis,
        drpPlan: scan.drpPlan,
      }),
    );

    expect(chain.steps.some((step) => step.type === 'finding')).toBe(true);
    expect(chain.steps.some((step) => step.type === 'evidence_gap')).toBe(true);
    expect(chain.conclusion.length).toBeGreaterThan(0);
  });

  it('caps findings at five and scenarios at three in the reasoning chain', () => {
    const service = createServiceEntry('api', 'critical', ['api-node']);
    const scan = createScanResult({
      services: [service],
      nodes: [createNode('api-node')],
      edges: [],
      results: [
        createRule('api-node', 'rule-1', 'fail', 'critical', 'backup', 'observed'),
        createRule('api-node', 'rule-2', 'fail', 'high', 'backup', 'observed'),
        createRule('api-node', 'rule-3', 'fail', 'high', 'failover', 'observed'),
        createRule('api-node', 'rule-4', 'warn', 'medium', 'recovery', 'observed'),
        createRule('api-node', 'rule-5', 'warn', 'medium', 'replication', 'observed'),
        createRule('api-node', 'rule-6', 'warn', 'low', 'detection', 'observed'),
      ],
      scenarios: [
        createScenario('api', 'uncovered', 's1'),
        createScenario('api', 'uncovered', 's2'),
        createScenario('api', 'partially_covered', 's3'),
        createScenario('api', 'covered', 's4'),
      ],
      drpPlan: createDrpPlan([service]),
    });
    const chain = buildReasoningChain(
      'api',
      scan,
      null,
      null,
      calculateRealityGap({
        nodes: scan.nodes,
        validationReport: scan.validationReport,
        servicePosture: scan.servicePosture,
        scenarioAnalysis: scan.scenarioAnalysis,
        drpPlan: scan.drpPlan,
      }),
    );

    expect(chain.steps.filter((step) => step.type === 'finding')).toHaveLength(5);
    expect(chain.steps.filter((step) => step.type === 'scenario_impact')).toHaveLength(3);
  });

  it('is deterministic for identical inputs', () => {
    const service = createServiceEntry('payment', 'critical', ['payment-db']);
    const scan = createScanResult({
      services: [service],
      nodes: [createNode('payment-db')],
      edges: [],
      results: [createRule('payment-db', 'backup-plan', 'pass', 'medium', 'backup', 'tested')],
      scenarios: [createScenario('payment', 'covered')],
      drpPlan: createDrpPlan([service]),
    });
    const realityGap = calculateRealityGap({
      nodes: scan.nodes,
      validationReport: scan.validationReport,
      servicePosture: scan.servicePosture,
      scenarioAnalysis: scan.scenarioAnalysis,
      drpPlan: scan.drpPlan,
    });

    expect(buildReasoningChain('payment', scan, null, null, realityGap)).toEqual(
      buildReasoningChain('payment', scan, null, null, realityGap),
    );
  });
});

function createScanResult(params: {
  readonly services: readonly ServicePostureService[];
  readonly nodes: ReasoningScanResult['nodes'];
  readonly edges: ReasoningScanResult['edges'];
  readonly results: readonly WeightedValidationResultWithEvidence[];
  readonly scenarios: NonNullable<ReasoningScanResult['scenarioAnalysis']>['scenarios'];
  readonly drpPlan: NonNullable<ReasoningScanResult['drpPlan']>;
}): ReasoningScanResult {
  return {
    provider: 'aws',
    scannedAt: new Date('2026-04-08T00:00:00.000Z'),
    timestamp: '2026-04-08T00:00:00.000Z',
    nodes: params.nodes,
    edges: params.edges,
    validationReport: createValidationReport(params.results),
    servicePosture: createPosture(params.services),
    scenarioAnalysis: {
      scenarios: params.scenarios,
      defaultScenarioIds: params.scenarios.map((scenario) => scenario.id),
      summary: {
        total: params.scenarios.length,
        covered: params.scenarios.filter((scenario) => scenario.coverage?.verdict === 'covered').length,
        partiallyCovered: params.scenarios.filter(
          (scenario) => scenario.coverage?.verdict === 'partially_covered',
        ).length,
        uncovered: params.scenarios.filter((scenario) => scenario.coverage?.verdict === 'uncovered').length,
        degraded: params.scenarios.filter((scenario) => scenario.coverage?.verdict === 'degraded').length,
      },
    },
    drpPlan: params.drpPlan,
  };
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
      score: 40,
      grade: 'D',
      findingsCount: { critical: 1, high: 1, medium: 1, low: 1 },
      findings: [],
      coverageGaps: [],
    },
    contextualFindings: [],
    recommendations: [
      {
        id: `${id}-rec`,
        title: `Improve ${id}`,
        description: `Improve ${id}`,
        category: 'backup',
        severity: 'high',
        targetNode: resourceIds[0] ?? id,
        targetNodeName: resourceIds[0] ?? id,
        impact: {
          scoreDelta: 4,
          affectedRules: ['backup-plan'],
        },
        risk: 'safe',
        riskReason: 'safe',
        remediation: {
          command: 'aws backup create-backup-plan',
          requiresDowntime: false,
          requiresMaintenanceWindow: false,
          estimatedDuration: '15m',
          prerequisites: [],
        },
        serviceId: id,
        serviceName: id,
        serviceCriticality: criticality,
        projectedScore: {
          current: 40,
          next: 44,
          currentGrade: 'D',
          nextGrade: 'D',
        },
        drImpactSummary: null,
      },
    ],
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
    skipped: 0,
    errors: results.filter((result) => result.status === 'error').length,
    results,
    score: 40,
    scoreBreakdown: {
      overall: 40,
      byCategory: {
        backup: 40,
        redundancy: 40,
        failover: 40,
        detection: 40,
        recovery: 40,
        replication: 40,
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
  ruleId: string,
  status: WeightedValidationResultWithEvidence['status'],
  severity: WeightedValidationResultWithEvidence['severity'],
  category: WeightedValidationResultWithEvidence['category'],
  evidenceType: WeightedValidationResultWithEvidence['weightBreakdown']['evidenceType'],
): WeightedValidationResultWithEvidence {
  return {
    ruleId,
    nodeId,
    nodeName: nodeId,
    nodeType: 'database',
    status,
    severity,
    category,
    weight: 1,
    message: `${ruleId} ${status}`,
    evidence: [
      {
        id: `${ruleId}-${nodeId}`,
        type: evidenceType,
        source:
          evidenceType === 'tested'
            ? { origin: 'test', testType: 'restore-test', testDate: '2026-04-08T00:00:00.000Z' }
            : { origin: 'scan', scanTimestamp: '2026-04-08T00:00:00.000Z' },
        subject: { nodeId, ruleId },
        observation: {
          key: ruleId,
          value: status,
          expected: 'pass',
          description: ruleId,
        },
        timestamp: '2026-04-08T00:00:00.000Z',
      },
    ],
    weightBreakdown: {
      severityWeight: 1,
      criticalityWeight: 1,
      blastRadiusWeight: 1,
      directDependentCount: 0,
      evidenceType,
      evidenceConfidence: evidenceType === 'tested' ? 1 : 0.85,
    },
  };
}

function createScenario(
  serviceId: string,
  verdict: 'covered' | 'partially_covered' | 'uncovered' | 'degraded',
  id = serviceId,
) {
  return {
    id,
    name: `Scenario ${id}`,
    description: 'test',
    type: 'region_failure' as const,
    disruption: {
      affectedNodes: [serviceId],
      selectionCriteria: 'test',
    },
    impact: {
      directlyAffected: [],
      cascadeAffected: [],
      totalAffectedNodes: 0,
      totalAffectedServices: [serviceId],
      serviceImpact: [
        {
          serviceId,
          serviceName: serviceId,
          affectedResources: 1,
          totalResources: 1,
          percentageAffected: 100,
          criticalResourcesAffected: [],
          status: verdict === 'covered' ? 'degraded' as const : 'down' as const,
        },
      ],
    },
    coverage: {
      verdict,
      details: [
        {
          serviceId,
          serviceName: serviceId,
          verdict,
          reason: verdict === 'covered' ? 'Covered.' : 'Needs work.',
          missingCapabilities: [],
          evidenceLevel: verdict === 'covered' ? 'tested' : 'observed',
        },
      ],
      summary: verdict,
    },
  };
}

function createDrpPlan(services: readonly ServicePostureService[]) {
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
        resourceType: 'database',
        name: resource.nodeId,
        region: 'eu-west-1',
        recoveryStrategy: 'restore_from_backup' as const,
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

function createNode(
  id: string,
  overrides: Partial<ReasoningScanResult['nodes'][number]> = {},
): ReasoningScanResult['nodes'][number] {
  return {
    id,
    name: id,
    type: 'database',
    provider: 'aws',
    region: 'eu-west-1',
    availabilityZone: 'eu-west-1a',
    tags: {},
    metadata: {},
    blastRadius: 1,
    isSPOF: false,
    dependentsCount: 1,
    ...overrides,
  };
}
