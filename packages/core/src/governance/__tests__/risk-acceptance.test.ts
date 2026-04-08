import { describe, expect, it } from 'vitest';

import { buildServicePosture } from '../../services/service-posture-builder.js';
import type { Service } from '../../services/service-types.js';
import {
  calculateScoreBreakdown,
  type InfraNode,
  type ValidationReport,
  type WeightedValidationResult,
} from '../../validation/index.js';
import {
  applyRiskAcceptances,
  applyRiskAcceptancesToServicePosture,
  materializeRiskAcceptances,
  type RiskAcceptance,
} from '../risk-acceptance.js';

describe('applyRiskAcceptances', () => {
  it('marks active acceptances as risk accepted', () => {
    const findings = [createFindingContext('backup_plan_exists', 'payment-db', 'high')];
    const acceptances = [createAcceptance()];

    const result = applyRiskAcceptances(findings, acceptances, new Date('2026-04-08T00:00:00Z'));

    expect(result[0]?.riskAccepted).toBe(true);
    expect(result[0]?.riskAcceptance?.status).toBe('active');
  });

  it('reactivates findings when the acceptance is expired', () => {
    const findings = [createFindingContext('backup_plan_exists', 'payment-db', 'high')];
    const acceptances = [
      createAcceptance({
        expiresAt: '2026-03-01T00:00:00Z',
      }),
    ];

    const result = applyRiskAcceptances(findings, acceptances, new Date('2026-04-08T00:00:00Z'));

    expect(result[0]?.riskAccepted).toBeUndefined();
    expect(result[0]?.riskAcceptance?.status).toBe('expired');
  });

  it('reactivates findings when the current severity is higher than the accepted severity', () => {
    const findings = [createFindingContext('backup_plan_exists', 'payment-db', 'high')];
    const acceptances = [
      createAcceptance({
        severityAtAcceptance: 'medium',
      }),
    ];

    const result = applyRiskAcceptances(findings, acceptances, new Date('2026-04-08T00:00:00Z'));

    expect(result[0]?.riskAccepted).toBeUndefined();
    expect(result[0]?.riskAcceptance?.status).toBe('superseded');
  });
});

describe('applyRiskAcceptancesToServicePosture', () => {
  it('excludes active accepted findings from the score while preserving the raw comparison score', () => {
    const nodes = [createNode('payment-db', 'DATABASE', 'rds')];
    const validationReport = createValidationReport([
      createValidationFinding('backup_plan_exists', 'payment-db', 'high', 'fail', 'backup', 10),
      createValidationFinding(
        'cloudwatch_alarm_exists',
        'payment-db',
        'low',
        'pass',
        'detection',
        10,
      ),
    ]);
    const posture = buildServicePosture({
      nodes,
      edges: [],
      validationReport,
      manualServices: [createService('payment', ['payment-db'])],
      recommendations: [],
    });

    const result = applyRiskAcceptancesToServicePosture(
      posture,
      validationReport,
      nodes,
      materializeRiskAcceptances([
        {
          id: 'ra-001',
          findingKey: 'backup_plan_exists::payment-db',
          acceptedBy: 'mehdi@example.com',
          justification: 'Approved for staging',
          acceptedAt: '2026-03-01T00:00:00Z',
          expiresAt: '2026-09-01T00:00:00Z',
          severityAtAcceptance: 'high',
        },
      ]),
      new Date('2026-04-08T00:00:00Z'),
    );

    expect(result.governance.score.withoutAcceptances.score).toBe(
      validationReport.scoreBreakdown.overall,
    );
    expect(result.governance.score.withAcceptances.score).toBeGreaterThan(
      result.governance.score.withoutAcceptances.score,
    );
    expect(result.governance.score.excludedFindings).toBe(1);
    expect(result.posture.services[0]?.score.findingsCount.high).toBe(0);
    expect(result.posture.services[0]?.contextualFindings[0]?.riskAccepted).toBe(true);
  });
});

function createService(id: string, resourceIds: readonly string[]): Service {
  return {
    id,
    name: id,
    criticality: 'critical',
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1.0,
    },
    resources: resourceIds.map((nodeId) => ({
      nodeId,
      detectionSource: {
        type: 'manual',
        file: '.stronghold/services.yml',
        confidence: 1.0,
      },
      role: 'datastore',
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
    metadata: {
      sourceType,
      criticality: 'critical',
    },
  };
}

function createValidationFinding(
  ruleId: string,
  nodeId: string,
  severity: WeightedValidationResult['severity'],
  status: WeightedValidationResult['status'],
  category: WeightedValidationResult['category'],
  weight: number,
): WeightedValidationResult {
  return {
    ruleId,
    nodeId,
    nodeName: nodeId,
    nodeType: 'test',
    status,
    severity,
    category,
    weight,
    message: `${ruleId} ${status}`,
    weightBreakdown: {
      severityWeight: 1,
      criticalityWeight: 1,
      blastRadiusWeight: 1,
      directDependentCount: 0,
    },
  };
}

function createValidationReport(
  results: readonly WeightedValidationResult[],
): ValidationReport {
  const scoreBreakdown = calculateScoreBreakdown(results);

  return {
    timestamp: '2026-04-08T00:00:00.000Z',
    totalChecks: results.length,
    passed: results.filter((result) => result.status === 'pass').length,
    failed: results.filter((result) => result.status === 'fail').length,
    warnings: results.filter((result) => result.status === 'warn').length,
    skipped: results.filter((result) => result.status === 'skip').length,
    errors: results.filter((result) => result.status === 'error').length,
    results,
    score: scoreBreakdown.overall,
    scoreBreakdown,
    criticalFailures: results.filter((result) => result.severity === 'critical'),
    scannedResources: 1,
  };
}

function createFindingContext(
  ruleId: string,
  nodeId: string,
  severity: WeightedValidationResult['severity'],
) {
  return {
    ruleId,
    nodeId,
    nodeName: nodeId,
    severity,
    category: 'backup' as const,
    passed: false,
    serviceId: 'payment',
    serviceName: 'payment',
    resourceRole: 'datastore' as const,
    technicalImpact: {
      observation: 'Missing backup plan',
      metadataKey: 'backupPlan',
      metadataValue: false,
      expectedValue: 'configured',
    },
    drImpact: {
      summary: 'Data recovery is not possible.',
      recoveryImplication: 'Restore requires a backup that does not exist.',
      affectedCapability: 'backup' as const,
    },
    scenarioImpact: null,
    remediation: null,
  };
}

function createAcceptance(
  overrides: Partial<RiskAcceptance> = {},
): RiskAcceptance {
  return {
    id: 'ra-001',
    findingKey: 'backup_plan_exists::payment-db',
    acceptedBy: 'mehdi@example.com',
    justification: 'Approved for staging',
    acceptedAt: '2026-03-01T00:00:00Z',
    expiresAt: '2026-09-01T00:00:00Z',
    severityAtAcceptance: 'high',
    status: 'active',
    ...overrides,
  };
}
