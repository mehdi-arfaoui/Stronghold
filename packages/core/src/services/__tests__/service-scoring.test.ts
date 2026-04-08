import { describe, expect, it } from 'vitest';

import type { Evidence } from '../../evidence/index.js';
import type {
  InfraNode,
  ValidationReport,
  WeightedValidationResult,
  WeightedValidationResultWithEvidence,
} from '../../validation/index.js';
import { scoreServices } from '../service-scoring.js';
import type { Service } from '../service-types.js';

describe('scoreServices', () => {
  it('caps the service at D when a critical datastore finding is unresolved', () => {
    const nodes = [
      createNode('db-1', 'DATABASE', 'rds'),
      createNode('lambda-1', 'SERVERLESS', 'lambda'),
    ];
    const result = scoreServices(
      [createService('payment', 'Payment', ['db-1', 'lambda-1'])],
      createValidationReport([
        createFinding('critical', 'fail', 'db-1', 1, 'backup'),
        createFinding('low', 'pass', 'lambda-1', 100, 'detection'),
      ]),
      nodes,
    );

    expect(result.services[0]?.score).toBeLessThanOrEqual(40);
    expect(result.services[0]?.grade).toBe('D');
  });

  it('caps the service at C when a high finding exists and no critical findings remain', () => {
    const nodes = [
      createNode('lambda-1', 'SERVERLESS', 'lambda'),
      createNode('lambda-2', 'SERVERLESS', 'lambda'),
    ];
    const result = scoreServices(
      [createService('auth', 'Auth', ['lambda-1', 'lambda-2'])],
      createValidationReport([
        createFinding('high', 'fail', 'lambda-1', 1, 'detection'),
        createFinding('low', 'pass', 'lambda-2', 100, 'backup'),
      ]),
      nodes,
    );

    expect(result.services[0]?.score).toBeLessThanOrEqual(60);
    expect(result.services[0]?.grade).toBe('C');
  });

  it('computes the score normally when only medium and low findings are present', () => {
    const nodes = [createNode('lambda-1', 'SERVERLESS', 'lambda')];
    const result = scoreServices(
      [createService('auth', 'Auth', ['lambda-1'])],
      createValidationReport([
        createFinding('medium', 'warn', 'lambda-1', 10, 'detection'),
        createFinding('low', 'pass', 'lambda-1', 10, 'backup'),
      ]),
      nodes,
    );

    expect(result.services[0]?.score).toBe(68);
    expect(result.services[0]?.grade).toBe('C');
  });

  it('rewards tested evidence more than observed evidence for passing service controls', () => {
    const nodes = [createNode('lambda-1', 'SERVERLESS', 'lambda')];
    const observedResult = scoreServices(
      [createService('auth', 'Auth', ['lambda-1'])],
      createValidationReport([createFinding('low', 'pass', 'lambda-1', 10, 'backup', 'observed')]),
      nodes,
    );
    const testedResult = scoreServices(
      [createService('auth', 'Auth', ['lambda-1'])],
      createValidationReport([createFinding('low', 'pass', 'lambda-1', 10, 'backup', 'tested')]),
      nodes,
    );

    expect(observedResult.services[0]?.score).toBe(85);
    expect(testedResult.services[0]?.score).toBe(100);
    expect(testedResult.services[0]?.score ?? 0).toBeGreaterThan(
      observedResult.services[0]?.score ?? 0,
    );
  });

  it('weights datastore findings more heavily than monitoring findings', () => {
    const nodes = [
      createNode('db-1', 'DATABASE', 'rds'),
      createNode('alarm-1', 'APPLICATION', 'cloudwatch_alarm'),
      createNode('lambda-1', 'SERVERLESS', 'lambda'),
    ];
    const datastoreService = scoreServices(
      [createService('payment', 'Payment', ['db-1', 'lambda-1'])],
      createValidationReport([
        createFinding('high', 'fail', 'db-1', 10, 'backup'),
        createFinding('low', 'pass', 'lambda-1', 10, 'detection'),
      ]),
      nodes,
    ).services[0];
    const monitoringService = scoreServices(
      [createService('monitoring', 'Monitoring', ['alarm-1', 'lambda-1'])],
      createValidationReport([
        createFinding('high', 'fail', 'alarm-1', 10, 'detection'),
        createFinding('low', 'pass', 'lambda-1', 10, 'detection'),
      ]),
      nodes,
    ).services[0];

    expect(datastoreService?.score ?? 0).toBeLessThan(monitoringService?.score ?? 100);
  });

  it('scores unassigned resources separately as a pseudo-service', () => {
    const nodes = [
      createNode('lambda-1', 'SERVERLESS', 'lambda'),
      createNode('orphan-db', 'DATABASE', 'rds'),
    ];
    const result = scoreServices(
      [createService('auth', 'Auth', ['lambda-1'])],
      createValidationReport([createFinding('high', 'fail', 'orphan-db', 10, 'backup')]),
      nodes,
    );

    expect(result.unassigned?.serviceId).toBe('__unassigned__');
    expect(result.unassigned?.findingsCount.high).toBe(1);
  });

  it('does not change the global score', () => {
    const report = createValidationReport([createFinding('high', 'fail', 'db-1', 10, 'backup')]);

    scoreServices([createService('payment', 'Payment', ['db-1'])], report, [
      createNode('db-1', 'DATABASE', 'rds'),
    ]);

    expect(report.scoreBreakdown.overall).toBe(55);
  });

  it('returns a perfect score for an empty service', () => {
    const result = scoreServices(
      [createService('empty', 'Empty', [])],
      createValidationReport([]),
      [],
    );

    expect(result.services[0]?.score).toBe(100);
    expect(result.services[0]?.grade).toBe('A');
  });
});

function createService(id: string, name: string, resourceIds: readonly string[]): Service {
  return {
    id,
    name,
    criticality: 'medium',
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1.0,
    },
    resources: resourceIds.map((resourceId) => ({
      nodeId: resourceId,
      detectionSource: {
        type: 'manual',
        file: '.stronghold/services.yml',
        confidence: 1.0,
      },
    })),
    metadata: {},
  };
}

function createNode(id: string, type: string, sourceType: string): InfraNode {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region: 'eu-west-1',
    availabilityZone: null,
    tags: {},
    metadata: { sourceType },
  };
}

function createFinding(
  severity: WeightedValidationResult['severity'],
  status: WeightedValidationResult['status'],
  nodeId: string,
  weight: number,
  category: WeightedValidationResult['category'],
  evidenceType: Evidence['type'] = 'observed',
): WeightedValidationResultWithEvidence {
  return {
    ruleId: `${category}-${severity}-${nodeId}`,
    nodeId,
    nodeName: nodeId,
    nodeType: 'test',
    status,
    severity,
    category,
    weight,
    message: `${nodeId} ${status}`,
    evidence: [createEvidence(nodeId, category, evidenceType)],
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

function createEvidence(
  nodeId: string,
  ruleId: string,
  type: Evidence['type'],
): Evidence {
  return {
    id: `${ruleId}-${nodeId}-${type}`,
    type,
    source:
      type === 'tested' || type === 'expired'
        ? { origin: 'test', testType: 'restore-test', testDate: '2026-04-08T00:00:00.000Z' }
        : { origin: 'scan', scanTimestamp: '2026-04-08T00:00:00.000Z' },
    subject: {
      nodeId,
      ruleId,
    },
    observation: {
      key: 'backupRetentionPeriod',
      value: statusValueForEvidence(type),
      expected: '> 0',
      description: `${type} evidence`,
    },
    timestamp: '2026-04-08T00:00:00.000Z',
    ...(type === 'expired' ? { expiresAt: '2026-04-01T00:00:00.000Z' } : {}),
  };
}

function statusValueForEvidence(type: Evidence['type']): unknown {
  return type === 'expired' ? 'stale' : 'success';
}

function createValidationReport(
  results: readonly WeightedValidationResult[],
): ValidationReport {
  return {
    timestamp: new Date('2026-04-08T00:00:00.000Z').toISOString(),
    totalChecks: results.length,
    passed: results.filter((result) => result.status === 'pass').length,
    failed: results.filter((result) => result.status === 'fail').length,
    warnings: results.filter((result) => result.status === 'warn').length,
    skipped: results.filter((result) => result.status === 'skip').length,
    errors: results.filter((result) => result.status === 'error').length,
    results,
    score: 55,
    scoreBreakdown: {
      overall: 55,
      byCategory: {
        backup: 55,
        redundancy: 55,
        failover: 55,
        detection: 55,
        recovery: 55,
        replication: 55,
      },
      grade: 'C',
      weakestCategory: 'backup',
      scoringMethod: 'test',
      disclaimer: 'test',
    },
    criticalFailures: results.filter((result) => result.severity === 'critical'),
    scannedResources: results.length,
  };
}
