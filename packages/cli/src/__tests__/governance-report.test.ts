import { describe, expect, it } from 'vitest';
import type { ContextualFinding, RiskAcceptance, Service, ServicePosture, ValidationReport } from '@stronghold-dr/core';

import { renderTerminalServiceReport } from '../output/report-renderer.js';
import type { ScanResults } from '../storage/file-store.js';

describe('governance report rendering', () => {
  it('shows score comparison and a dedicated risk-accepted findings section', () => {
    const service = createService();
    const acceptance: RiskAcceptance = {
      id: 'ra-001',
      findingKey: 'backup_plan_exists::payment-db',
      acceptedBy: 'mehdi@example.com',
      justification: 'Approved for staging',
      acceptedAt: '2026-03-01T00:00:00Z',
      expiresAt: '2026-09-01T00:00:00Z',
      severityAtAcceptance: 'high',
      status: 'active',
    };
    const finding: ContextualFinding = {
      ruleId: 'backup_plan_exists',
      nodeId: 'payment-db',
      nodeName: 'payment-db',
      severity: 'high',
      category: 'backup',
      passed: false,
      serviceId: 'payment',
      serviceName: 'Payment',
      resourceRole: 'datastore',
      technicalImpact: {
        observation: 'Missing backup plan',
        metadataKey: 'backupPlan',
        metadataValue: false,
        expectedValue: 'configured',
      },
      drImpact: {
        summary: 'Data recovery is not possible.',
        recoveryImplication: 'Restore requires a backup that does not exist.',
        affectedCapability: 'backup',
      },
      scenarioImpact: null,
      remediation: null,
      riskAccepted: true,
      riskAcceptance: acceptance,
      policyViolations: [
        {
          policyId: 'pol-001',
          policyName: 'Critical services must have backup',
          findingKey: 'backup_plan_exists::payment-db',
          nodeId: 'payment-db',
          serviceId: 'payment',
          severity: 'critical',
          message: 'payment-db violates policy "Critical services must have backup".',
        },
      ],
    };

    const scan = {
      timestamp: '2026-04-08T00:00:00.000Z',
      validationReport: createValidationReport(),
      servicePosture: createPosture(service, finding),
      governance: {
        riskAcceptances: [acceptance],
        score: {
          withAcceptances: { score: 95, grade: 'A' },
          withoutAcceptances: { score: 55, grade: 'C' },
          excludedFindings: 1,
        },
      },
    } as unknown as ScanResults;

    const rendered = renderTerminalServiceReport(scan, {});

    expect(rendered).toContain('Global score: 95/100 (A) - without acceptances: 55/100 (C)');
    expect(rendered).toContain('Risk-Accepted Findings');
    expect(rendered).toContain('ACCEPTED backup_plan_exists - payment-db');
    expect(rendered).toContain('POLICY VIOLATION: pol-001 "Critical services must have backup"');
  });
});

function createService(): Service {
  return {
    id: 'payment',
    name: 'Payment',
    criticality: 'critical',
    owner: 'team-backend',
    governance: {
      owner: 'team-backend',
      ownerStatus: 'confirmed',
    },
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1.0,
    },
    resources: [
      {
        nodeId: 'payment-db',
        role: 'datastore',
        detectionSource: {
          type: 'manual',
          file: '.stronghold/services.yml',
          confidence: 1.0,
        },
      },
    ],
    metadata: {},
  };
}

function createPosture(
  service: Service,
  finding: ContextualFinding,
): ServicePosture {
  return {
    detection: {
      services: [service],
      unassignedResources: [],
      detectionSummary: {
        cloudformation: 0,
        tag: 0,
        topology: 0,
        manual: 1,
        totalResources: 1,
        assignedResources: 1,
        unassignedResources: 0,
      },
    },
    scoring: {
      services: [
        {
          serviceId: service.id,
          serviceName: service.name,
          resourceCount: 1,
          criticality: 'critical',
          owner: 'team-backend',
          detectionSource: service.detectionSource,
          score: 95,
          grade: 'A',
          findingsCount: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
          },
          findings: [],
          coverageGaps: [],
        },
      ],
      unassigned: null,
    },
    contextualFindings: [finding],
    recommendations: [],
    services: [
      {
        service,
        score: {
          serviceId: service.id,
          serviceName: service.name,
          resourceCount: 1,
          criticality: 'critical',
          owner: 'team-backend',
          detectionSource: service.detectionSource,
          score: 95,
          grade: 'A',
          findingsCount: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
          },
          findings: [],
          coverageGaps: [],
        },
        contextualFindings: [finding],
        recommendations: [],
      },
    ],
    unassigned: {
      score: null,
      resourceCount: 0,
      contextualFindings: [],
      recommendations: [],
    },
  };
}

function createValidationReport(): ValidationReport {
  return {
    timestamp: '2026-04-08T00:00:00.000Z',
    totalChecks: 1,
    passed: 0,
    failed: 1,
    warnings: 0,
    skipped: 0,
    errors: 0,
    results: [],
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
    criticalFailures: [],
    scannedResources: 1,
  };
}
