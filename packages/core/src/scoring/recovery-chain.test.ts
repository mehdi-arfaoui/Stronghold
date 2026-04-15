import { describe, expect, it } from 'vitest';

import { NodeType, type Evidence, type Service, type ServicePosture, type ServicePostureService, type ValidationReport, type WeightedValidationResultWithEvidence } from '../index.js';
import { calculateFullChainCoverage } from './recovery-chain.js';

describe('calculateFullChainCoverage', () => {
  it('returns 100% coverage when every recovery step is tested and passing', () => {
    const service = createServiceEntry('payment', [
      { nodeId: 'payment-db', role: 'datastore' },
      { nodeId: 'payment-api', role: 'compute' },
      { nodeId: 'payment-bucket', role: 'storage' },
    ]);
    const result = calculateFullChainCoverage({
      nodes: [
        createNode('payment-db', NodeType.DATABASE, 5, { sourceType: 'rds' }),
        createNode('payment-api', NodeType.VM, 3, { sourceType: 'ec2' }),
        createNode('payment-bucket', NodeType.OBJECT_STORAGE, 1, { sourceType: 's3_bucket' }),
      ],
      edges: [],
      validationReport: createValidationReport([
        createRule('payment-db', 'backup-db', 'pass', 'high', 'backup', 'tested'),
        createRule('payment-api', 'recovery-api', 'pass', 'high', 'recovery', 'tested'),
        createRule('payment-bucket', 'backup-bucket', 'pass', 'medium', 'backup', 'tested'),
      ]),
      servicePosture: createPosture([service]),
      drpPlan: createDrpPlan([
        {
          service,
          recoveryOrder: ['payment-db', 'payment-api', 'payment-bucket'],
        },
      ]),
      evidenceRecords: null,
    });

    expect(result.chains[0]?.provenSteps).toBe(3);
    expect(result.chains[0]?.weightedCoverage).toBe(100);
    expect(result.chains[0]?.unweightedCoverage).toBe(100);
    expect(result.globalWeightedCoverage).toBe(100);
  });

  it('tracks blocked, proven, and observed steps separately', () => {
    const service = createServiceEntry('orders', [
      { nodeId: 'orders-db', role: 'datastore' },
      { nodeId: 'orders-api', role: 'compute' },
      { nodeId: 'orders-cache', role: 'other' },
    ]);
    const result = calculateFullChainCoverage({
      nodes: [
        createNode('orders-db', NodeType.DATABASE, 4, { sourceType: 'rds' }),
        createNode('orders-api', NodeType.VM, 2, { sourceType: 'ec2' }),
        createNode('orders-cache', NodeType.CACHE, 1, { sourceType: 'elasticache' }),
      ],
      edges: [],
      validationReport: createValidationReport([
        createRule('orders-db', 'backup-db', 'fail', 'critical', 'backup'),
        createRule('orders-api', 'recovery-api', 'pass', 'high', 'recovery', 'tested'),
        createRule('orders-cache', 'failover-cache', 'pass', 'medium', 'failover', 'observed'),
      ]),
      servicePosture: createPosture([service]),
      drpPlan: createDrpPlan([
        {
          service,
          recoveryOrder: ['orders-db', 'orders-cache', 'orders-api'],
        },
      ]),
      evidenceRecords: null,
    });

    expect(result.chains[0]?.provenSteps).toBe(1);
    expect(result.chains[0]?.blockedSteps).toBe(1);
    expect(result.chains[0]?.observedSteps).toBe(1);
    expect(result.servicesWithBlockedSteps).toBe(1);
  });

  it('weights datastore gaps more heavily than compute gaps', () => {
    const service = createServiceEntry('billing', [
      { nodeId: 'billing-db', role: 'datastore' },
      { nodeId: 'billing-api', role: 'compute' },
      { nodeId: 'billing-worker', role: 'compute' },
    ]);
    const result = calculateFullChainCoverage({
      nodes: [
        createNode('billing-db', NodeType.DATABASE, 5, { sourceType: 'rds' }),
        createNode('billing-api', NodeType.VM, 3, { sourceType: 'ec2' }),
        createNode('billing-worker', NodeType.VM, 2, { sourceType: 'ec2' }),
      ],
      edges: [],
      validationReport: createValidationReport([
        createRule('billing-db', 'backup-db', 'fail', 'high', 'backup'),
        createRule('billing-api', 'recovery-api', 'pass', 'high', 'recovery', 'tested'),
        createRule('billing-worker', 'recovery-worker', 'pass', 'high', 'recovery', 'tested'),
      ]),
      servicePosture: createPosture([service]),
      drpPlan: createDrpPlan([
        {
          service,
          recoveryOrder: ['billing-db', 'billing-api', 'billing-worker'],
        },
      ]),
      evidenceRecords: null,
    });

    expect(result.chains[0]?.weightedCoverage).toBeLessThan(
      result.chains[0]?.unweightedCoverage ?? 0,
    );
  });

  it('falls back to datastore-first ordering when no DRP exists', () => {
    const service = createServiceEntry('catalog', [
      { nodeId: 'catalog-api', role: 'compute' },
      { nodeId: 'catalog-bucket', role: 'storage' },
      { nodeId: 'catalog-db', role: 'datastore' },
    ]);
    const result = calculateFullChainCoverage({
      nodes: [
        createNode('catalog-api', NodeType.VM, 2, { sourceType: 'ec2' }),
        createNode('catalog-bucket', NodeType.OBJECT_STORAGE, 1, { sourceType: 's3_bucket' }),
        createNode('catalog-db', NodeType.DATABASE, 5, { sourceType: 'rds' }),
      ],
      edges: [],
      validationReport: createValidationReport([
        createRule('catalog-api', 'recovery-api', 'pass', 'high', 'recovery', 'observed'),
        createRule('catalog-bucket', 'backup-bucket', 'pass', 'medium', 'backup', 'observed'),
        createRule('catalog-db', 'backup-db', 'pass', 'high', 'backup', 'observed'),
      ]),
      servicePosture: createPosture([service]),
      drpPlan: null,
      evidenceRecords: null,
    });

    expect(result.chains[0]?.steps[0]?.nodeId).toBe('catalog-db');
  });

  it('treats expired evidence as observed instead of proven', () => {
    const service = createServiceEntry('search', [{ nodeId: 'search-db', role: 'datastore' }]);
    const result = calculateFullChainCoverage({
      nodes: [createNode('search-db', NodeType.DATABASE, 3, { sourceType: 'rds' })],
      edges: [],
      validationReport: createValidationReport([
        createRule('search-db', 'backup-db', 'pass', 'high', 'backup'),
      ]),
      servicePosture: createPosture([service]),
      drpPlan: createDrpPlan([
        {
          service,
          recoveryOrder: ['search-db'],
        },
      ]),
      evidenceRecords: [
        createEvidence('search-db', 'tested', {
          timestamp: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-02-01T00:00:00.000Z',
        }),
      ],
    });

    expect(result.chains[0]?.provenSteps).toBe(0);
    expect(result.chains[0]?.observedSteps).toBe(1);
    expect(result.chains[0]?.steps[0]?.status).toBe('observed');
    expect(result.chains[0]?.steps[0]?.statusReason).toContain('Evidence expired');
  });

  it('returns empty aggregates when no services are detected', () => {
    const result = calculateFullChainCoverage({
      nodes: [],
      edges: [],
      validationReport: createValidationReport([]),
      servicePosture: createPosture([]),
      drpPlan: null,
      evidenceRecords: null,
    });

    expect(result.chains).toEqual([]);
    expect(result.globalUnweightedCoverage).toBe(0);
    expect(result.globalWeightedCoverage).toBe(0);
  });

  it('is deterministic for identical inputs', () => {
    const service = createServiceEntry('identity', [
      { nodeId: 'identity-db', role: 'datastore' },
      { nodeId: 'identity-api', role: 'compute' },
    ]);
    const input = {
      nodes: [
        createNode('identity-db', NodeType.DATABASE, 4, { sourceType: 'rds' }),
        createNode('identity-api', NodeType.VM, 2, { sourceType: 'ec2' }),
      ],
      edges: [],
      validationReport: createValidationReport([
        createRule('identity-db', 'backup-db', 'pass', 'high', 'backup', 'tested'),
        createRule('identity-api', 'recovery-api', 'pass', 'high', 'recovery', 'observed'),
      ]),
      servicePosture: createPosture([service]),
      drpPlan: createDrpPlan([
        {
          service,
          recoveryOrder: ['identity-db', 'identity-api'],
        },
      ]),
      evidenceRecords: null,
    } as const;

    expect(calculateFullChainCoverage(input)).toEqual(calculateFullChainCoverage(input));
  });

  it('assigns the expected role weights', () => {
    const service = createServiceEntry('weights', [
      { nodeId: 'weights-db', role: 'datastore' },
      { nodeId: 'weights-api', role: 'compute' },
      { nodeId: 'weights-bucket', role: 'storage' },
      { nodeId: 'weights-dns', role: 'network' },
      { nodeId: 'weights-queue', role: 'other' },
    ]);
    const result = calculateFullChainCoverage({
      nodes: [
        createNode('weights-db', NodeType.DATABASE, 4, { sourceType: 'rds' }),
        createNode('weights-api', NodeType.VM, 2, { sourceType: 'ec2' }),
        createNode('weights-bucket', NodeType.OBJECT_STORAGE, 1, { sourceType: 's3_bucket' }),
        createNode('weights-dns', NodeType.DNS, 1, { sourceType: 'route53_record' }),
        createNode('weights-queue', NodeType.MESSAGE_QUEUE, 1, { sourceType: 'sqs' }),
      ],
      edges: [],
      validationReport: createValidationReport([
        createRule('weights-db', 'backup-db', 'pass', 'high', 'backup'),
        createRule('weights-api', 'recovery-api', 'pass', 'high', 'recovery'),
        createRule('weights-bucket', 'backup-bucket', 'pass', 'medium', 'backup'),
        createRule('weights-dns', 'failover-dns', 'pass', 'medium', 'failover'),
        createRule('weights-queue', 'recovery-queue', 'pass', 'medium', 'recovery'),
      ]),
      servicePosture: createPosture([service]),
      drpPlan: null,
      evidenceRecords: null,
    });

    expect(
      result.chains[0]?.steps.map((step) => [step.nodeId, step.weight]),
    ).toEqual([
      ['weights-db', 4],
      ['weights-api', 3],
      ['weights-dns', 1],
      ['weights-bucket', 2],
      ['weights-queue', 1],
    ]);
  });
});

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
  resources: ReadonlyArray<{
    readonly nodeId: string;
    readonly role?: Service['resources'][number]['role'];
  }>,
): ServicePostureService {
  const service: Service = {
    id,
    name: id,
    criticality: 'critical',
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1.0,
    },
    resources: resources.map((resource) => ({
      nodeId: resource.nodeId,
      ...(resource.role ? { role: resource.role } : {}),
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
      resourceCount: resources.length,
      criticality: 'critical',
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
  ruleId: string,
  status: WeightedValidationResultWithEvidence['status'],
  severity: WeightedValidationResultWithEvidence['severity'],
  category: WeightedValidationResultWithEvidence['category'],
  evidenceType?: WeightedValidationResultWithEvidence['weightBreakdown']['evidenceType'],
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
    evidence: evidenceType ? [createEvidence(nodeId, evidenceType, { ruleId })] : [],
    weightBreakdown: {
      severityWeight: 1,
      criticalityWeight: 1,
      blastRadiusWeight: 1,
      directDependentCount: 0,
      evidenceType: evidenceType ?? 'observed',
      evidenceConfidence: {
        observed: 0.85,
        inferred: 0.5,
        declared: 0.7,
        tested: 1,
        expired: 0.2,
      }[evidenceType ?? 'observed'],
    },
  };
}

function createEvidence(
  nodeId: string,
  type: Evidence['type'],
  overrides: {
    readonly timestamp?: string;
    readonly expiresAt?: string;
    readonly ruleId?: string;
  } = {},
): Evidence {
  const timestamp = overrides.timestamp ?? '2026-04-01T00:00:00.000Z';

  return {
    id: `${nodeId}-${type}-${overrides.ruleId ?? 'evidence'}`,
    type,
    source:
      type === 'tested' || type === 'expired'
        ? {
            origin: 'test',
            testType: 'restore-test',
            testDate: timestamp,
          }
        : {
            origin: 'scan',
            scanTimestamp: timestamp,
          },
    subject: {
      nodeId,
      ...(overrides.ruleId ? { ruleId: overrides.ruleId } : {}),
    },
    observation: {
      key: 'evidence',
      value: type,
      expected: 'pass',
      description: `${type} evidence`,
    },
    timestamp,
    ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
  };
}

function createNode(
  id: string,
  type: NodeType,
  blastRadius: number,
  metadata: Record<string, unknown>,
) {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region: 'eu-west-1',
    availabilityZone: 'eu-west-1a',
    tags: {},
    metadata,
    blastRadius,
  };
}

function createDrpPlan(
  services: ReadonlyArray<{
    readonly service: ServicePostureService;
    readonly recoveryOrder: readonly string[];
  }>,
) {
  return {
    id: 'drp-test',
    version: '1.0.0',
    generated: '2026-04-08T00:00:00.000Z',
    infrastructureHash: 'hash',
    provider: 'aws',
    regions: ['eu-west-1'],
    services: services.map((entry) => ({
      name: entry.service.service.name,
      criticality: entry.service.service.criticality,
      rtoTarget: '1h',
      rpoTarget: '15m',
      components: entry.recoveryOrder.map((nodeId) => ({
        resourceId: nodeId,
        resourceType: nodeId.includes('bucket')
          ? 's3_bucket'
          : nodeId.includes('dns')
            ? 'route53_record'
            : nodeId.includes('api') || nodeId.includes('worker')
              ? 'ec2'
              : 'rds',
        name: nodeId,
        region: 'eu-west-1',
        recoveryStrategy: nodeId.includes('dns')
          ? ('dns_failover' as const)
          : nodeId.includes('api') || nodeId.includes('worker')
            ? ('rebuild' as const)
            : nodeId.includes('bucket')
              ? ('restore_from_backup' as const)
              : ('restore_from_backup' as const),
        recoverySteps: [],
        estimatedRTO: '1h',
        estimatedRPO: '15m',
        dependencies: [],
        risks: [],
      })),
      validationTests: [],
      estimatedRTO: '1h',
      estimatedRPO: '15m',
      recoveryOrder: entry.recoveryOrder,
    })),
    metadata: {
      totalResources: services.reduce((sum, entry) => sum + entry.service.service.resources.length, 0),
      coveredResources: services.reduce((sum, entry) => sum + entry.service.service.resources.length, 0),
      uncoveredResources: [],
      worstCaseRTO: '1h',
      averageRPO: '15m',
      stale: false,
    },
  };
}
