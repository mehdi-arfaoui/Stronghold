import { describe, expect, it } from 'vitest';

import type {
  GovernanceState,
  ReasoningScanResult,
  Service,
  ServicePosture,
  ServicePostureService,
  ValidationReport,
  WeightedValidationResultWithEvidence,
} from '../index.js';
import {
  detectCascadeFailure,
  detectRecoveryPathErosion,
  detectRiskAcceptanceInvalidation,
  detectSilentDependencyDrift,
} from './graph-insights.js';

describe('graph insights', () => {
  it('detects cascade failure when a SPOF impacts multiple downstream services', () => {
    const scan = createScanResult({
      services: [
        createServiceEntry('database', 'critical', ['db']),
        createServiceEntry('payment', 'critical', ['payment-api']),
        createServiceEntry('checkout', 'high', ['checkout-api']),
        createServiceEntry('billing', 'high', ['billing-api']),
      ],
      nodes: [
        createNode('db', { isSPOF: true, blastRadius: 5 }),
        createNode('payment-api'),
        createNode('checkout-api'),
        createNode('billing-api'),
      ],
      edges: [
        createEdge('payment-api', 'db'),
        createEdge('checkout-api', 'payment-api'),
        createEdge('billing-api', 'payment-api'),
      ],
      results: [],
    });

    const insight = detectCascadeFailure('database', scan);

    expect(insight?.type).toBe('cascade_failure');
    expect(insight?.affectedServices).toEqual(['billing', 'checkout', 'payment']);
    expect(insight?.evidence.length).toBeGreaterThan(0);
  });

  it('detects silent dependency drift when more than two new edges are added', () => {
    const current = createScanResult({
      services: [createServiceEntry('payment', 'critical', ['payment-api'])],
      nodes: [
        createNode('payment-api', { blastRadius: 4 }),
        createNode('db'),
        createNode('cache'),
        createNode('queue'),
      ],
      edges: [
        createEdge('payment-api', 'db'),
        createEdge('payment-api', 'cache'),
        createEdge('payment-api', 'queue'),
      ],
      results: [],
    });
    const previous = createScanResult({
      services: [createServiceEntry('payment', 'critical', ['payment-api'])],
      nodes: [createNode('payment-api', { blastRadius: 1 }), createNode('db')],
      edges: [createEdge('payment-api', 'db')],
      results: [],
    });

    const insight = detectSilentDependencyDrift('payment', current, previous);

    expect(insight?.type).toBe('silent_dependency_drift');
    expect(insight?.evidence).toHaveLength(2);
  });

  it('detects risk acceptance invalidation when blast radius changes after acceptance', () => {
    const current = createScanResult({
      services: [
        createServiceEntry('database', 'critical', ['db']),
        createServiceEntry('payment', 'critical', ['payment-api']),
      ],
      nodes: [createNode('db', { blastRadius: 4 }), createNode('payment-api')],
      edges: [createEdge('payment-api', 'db')],
      results: [createRule('db', 'db-backup', 'fail', 'critical', 'backup', 'observed')],
      governance: createGovernance('db-backup::db'),
    });
    const previous = createScanResult({
      services: [createServiceEntry('database', 'critical', ['db'])],
      nodes: [createNode('db', { blastRadius: 1 })],
      edges: [],
      results: [createRule('db', 'db-backup', 'fail', 'critical', 'backup', 'observed')],
    });

    const insight = detectRiskAcceptanceInvalidation(
      'database',
      current,
      current.governance ?? null,
      previous,
    );

    expect(insight?.type).toBe('risk_acceptance_invalidation');
    expect(insight?.evidence).toContain('blast radius increased by 3');
  });

  it('detects recovery path erosion when passing recovery rules regress', () => {
    const current = createScanResult({
      services: [createServiceEntry('database', 'critical', ['db'])],
      nodes: [createNode('db')],
      edges: [],
      results: [
        createRule('db', 'backup-plan', 'fail', 'critical', 'backup', 'observed'),
        createRule('db', 'cross-region-replica', 'fail', 'high', 'replication', 'observed'),
      ],
    });
    const previous = createScanResult({
      services: [createServiceEntry('database', 'critical', ['db'])],
      nodes: [createNode('db')],
      edges: [],
      results: [
        createRule('db', 'backup-plan', 'pass', 'critical', 'backup', 'tested'),
        createRule('db', 'cross-region-replica', 'pass', 'high', 'replication', 'tested'),
      ],
    });

    const insight = detectRecoveryPathErosion('database', current, previous);

    expect(insight?.type).toBe('recovery_path_erosion');
    expect(insight?.severity).toBe('critical');
    expect(insight?.evidence).toEqual([
      'backup-plan: pass -> fail',
      'cross-region-replica: pass -> fail',
    ]);
  });

  it('returns null for temporal insights when no previous scan exists', () => {
    const scan = createScanResult({
      services: [createServiceEntry('database', 'critical', ['db'])],
      nodes: [createNode('db')],
      edges: [],
      results: [],
    });

    expect(detectSilentDependencyDrift('database', scan, null)).toBeNull();
    expect(detectRecoveryPathErosion('database', scan, null)).toBeNull();
    expect(detectRiskAcceptanceInvalidation('database', scan, scan.governance ?? null, null)).toBeNull();
  });
});

function createScanResult(params: {
  readonly services: readonly ServicePostureService[];
  readonly nodes: ReasoningScanResult['nodes'];
  readonly edges: ReasoningScanResult['edges'];
  readonly results: readonly WeightedValidationResultWithEvidence[];
  readonly governance?: GovernanceState | null;
}): ReasoningScanResult {
  return {
    provider: 'aws',
    scannedAt: new Date('2026-04-08T00:00:00.000Z'),
    timestamp: '2026-04-08T00:00:00.000Z',
    nodes: params.nodes,
    edges: params.edges,
    validationReport: createValidationReport(params.results),
    servicePosture: createPosture(params.services),
    scenarioAnalysis: null,
    drpPlan: null,
    ...(params.governance ? { governance: params.governance } : {}),
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
      role: resourceId === 'db' ? 'datastore' : 'compute',
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
      findingsCount: { critical: 1, high: 0, medium: 0, low: 0 },
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

function createNode(
  id: string,
  overrides: Partial<ReasoningScanResult['nodes'][number]> = {},
): ReasoningScanResult['nodes'][number] {
  return {
    id,
    name: id,
    type: id === 'db' ? 'database' : 'compute',
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

function createEdge(source: string, target: string): ReasoningScanResult['edges'][number] {
  return {
    source,
    target,
    type: 'depends_on',
    confidence: 1,
  };
}

function createGovernance(findingKey: string): GovernanceState {
  return {
    riskAcceptances: [
      {
        id: 'acceptance-1',
        findingKey,
        acceptedBy: 'owner@example.com',
        justification: 'Temporary mitigation accepted',
        acceptedAt: '2026-04-01T00:00:00.000Z',
        expiresAt: '2026-06-01T00:00:00.000Z',
        severityAtAcceptance: 'critical',
        status: 'active',
      },
    ],
    score: {
      withAcceptances: { score: 60, grade: 'C' },
      withoutAcceptances: { score: 40, grade: 'D' },
      excludedFindings: 1,
    },
  };
}
