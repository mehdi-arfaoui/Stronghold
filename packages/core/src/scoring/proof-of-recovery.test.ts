import { describe, expect, it } from 'vitest';

import { calculateProofOfRecovery } from './proof-of-recovery.js';
import type {
  Service,
  ServicePosture,
  ServicePostureService,
  ValidationReport,
  WeightedValidationResultWithEvidence,
} from '../index.js';

describe('calculateProofOfRecovery', () => {
  it('returns null when no services are detected', () => {
    const result = calculateProofOfRecovery({
      servicePosture: createPosture([]),
      validationReport: createValidationReport([]),
    });

    expect(result.proofOfRecovery).toBeNull();
    expect(result.proofOfRecoveryAll).toBeNull();
    expect(result.observedCoverage).toBe(0);
    expect(result.perService).toEqual([]);
  });

  it('returns 0 when critical services have no tested evidence', () => {
    const result = calculateProofOfRecovery({
      servicePosture: createPosture([
        createServiceEntry('service-a', 'critical', ['db-a']),
        createServiceEntry('service-b', 'critical', ['db-b']),
        createServiceEntry('service-c', 'critical', ['db-c']),
      ]),
      validationReport: createValidationReport([
        createPassingRule('db-a', 'observed'),
        createPassingRule('db-b', 'observed'),
        createPassingRule('db-c', 'observed'),
      ]),
    });

    expect(result.proofOfRecovery).toBe(0);
    expect(result.proofOfRecoveryAll).toBe(0);
  });

  it('rounds to 33 when one of three critical services has tested evidence', () => {
    const result = calculateProofOfRecovery({
      servicePosture: createPosture([
        createServiceEntry('service-a', 'critical', ['db-a']),
        createServiceEntry('service-b', 'critical', ['db-b']),
        createServiceEntry('service-c', 'critical', ['db-c']),
      ]),
      validationReport: createValidationReport([
        createPassingRule('db-a', 'tested'),
        createPassingRule('db-b', 'observed'),
        createPassingRule('db-c', 'observed'),
      ]),
    });

    expect(result.proofOfRecovery).toBe(33);
    expect(result.proofOfRecoveryAll).toBe(33);
    expect(result.perService.find((service) => service.serviceId === 'service-a')?.testedRuleCount).toBe(1);
  });

  it('returns 100 when every critical service has tested evidence', () => {
    const result = calculateProofOfRecovery({
      servicePosture: createPosture([
        createServiceEntry('service-a', 'critical', ['db-a']),
        createServiceEntry('service-b', 'critical', ['db-b']),
        createServiceEntry('service-c', 'critical', ['db-c']),
      ]),
      validationReport: createValidationReport([
        createPassingRule('db-a', 'tested'),
        createPassingRule('db-b', 'tested'),
        createPassingRule('db-c', 'tested'),
      ]),
    });

    expect(result.proofOfRecovery).toBe(100);
    expect(result.proofOfRecoveryAll).toBe(100);
  });

  it('does not count expired tested evidence as proof', () => {
    const result = calculateProofOfRecovery({
      servicePosture: createPosture([createServiceEntry('service-a', 'critical', ['db-a'])]),
      validationReport: createValidationReport([createPassingRule('db-a', 'expired')]),
    });

    expect(result.proofOfRecovery).toBe(0);
    expect(result.proofOfRecoveryAll).toBe(0);
  });

  it('does not count observed evidence toward proof of recovery', () => {
    const result = calculateProofOfRecovery({
      servicePosture: createPosture([
        createServiceEntry('service-a', 'critical', ['db-a']),
        createServiceEntry('service-b', 'high', ['db-b']),
      ]),
      validationReport: createValidationReport([
        createPassingRule('db-a', 'observed'),
        createPassingRule('db-b', 'observed'),
      ]),
    });

    expect(result.proofOfRecovery).toBe(0);
    expect(result.proofOfRecoveryAll).toBe(0);
    expect(result.perService.every((service) => service.hasObservedEvidence)).toBe(true);
  });

  it('counts observed coverage only on passing rules', () => {
    const result = calculateProofOfRecovery({
      servicePosture: createPosture([createServiceEntry('service-a', 'critical', ['db-a'])]),
      validationReport: createValidationReport([
        createPassingRule('db-a', 'observed'),
        createPassingRule('db-a', 'tested'),
        createFailingRule('db-a', 'observed'),
      ]),
    });

    expect(result.observedCoverage).toBe(50);
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

function createPassingRule(
  nodeId: string,
  evidenceType: WeightedValidationResultWithEvidence['weightBreakdown']['evidenceType'],
): WeightedValidationResultWithEvidence {
  return createRule(nodeId, 'pass', evidenceType);
}

function createFailingRule(
  nodeId: string,
  evidenceType: WeightedValidationResultWithEvidence['weightBreakdown']['evidenceType'],
): WeightedValidationResultWithEvidence {
  return createRule(nodeId, 'fail', evidenceType);
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
        ...(evidenceType === 'expired'
          ? { expiresAt: '2026-04-01T00:00:00.000Z' }
          : {}),
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
