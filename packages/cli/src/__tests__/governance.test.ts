import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  parseGovernanceConfig,
  type ContextualFinding,
  type GovernanceConfig,
  type Service,
  type ServicePosture,
  type ValidationReport,
} from '@stronghold-dr/core';

import {
  acceptGovernanceRisk,
  initGovernanceFile,
  validateGovernanceAgainstScan,
} from '../commands/governance.js';
import { renderGovernanceOverview } from '../output/governance-renderer.js';
import type { ScanResults } from '../storage/file-store.js';

describe('governance CLI helpers', () => {
  it('initializes a commented governance template', async () => {
    const root = createTempDirectory('stronghold-governance-');
    const governancePath = path.join(root, '.stronghold', 'governance.yml');
    const auditLogPath = path.join(root, '.stronghold', 'audit.jsonl');

    await initGovernanceFile(governancePath, auditLogPath);

    expect(fs.readFileSync(governancePath, 'utf8')).toContain('# Stronghold DR Governance');
  });

  it('appends a risk acceptance and logs audit entries', async () => {
    const root = createTempDirectory('stronghold-governance-');
    const governancePath = path.join(root, '.stronghold', 'governance.yml');
    const auditLogPath = path.join(root, '.stronghold', 'audit.jsonl');
    fs.mkdirSync(path.dirname(governancePath), { recursive: true });
    fs.writeFileSync(governancePath, 'version: 1\n', 'utf8');

    const result = await acceptGovernanceRisk({
      governancePath,
      auditLogPath,
      scan: createScan(),
      findingKey: 'backup_plan_exists::payment-db',
      acceptedBy: 'mehdi@example.com',
      justification: 'Test acceptance',
      expiresDays: 90,
      now: new Date('2026-04-08T00:00:00Z'),
    });

    const parsed = parseGovernanceConfig(fs.readFileSync(governancePath, 'utf8'), {
      filePath: governancePath,
    });
    const auditLines = fs.readFileSync(auditLogPath, 'utf8').trim().split('\n');

    expect(result.acceptanceId).toBe('ra-001');
    expect(parsed.riskAcceptances).toHaveLength(1);
    expect(parsed.riskAcceptances[0]?.findingKey).toBe('backup_plan_exists::payment-db');
    expect(auditLines.some((line) => line.includes('"action":"risk_accept"'))).toBe(true);
    expect(auditLines.some((line) => line.includes('"action":"governance_edit"'))).toBe(true);
  });

  it('blocks risk acceptance when the finding violates policy', async () => {
    const root = createTempDirectory('stronghold-governance-');
    const governancePath = path.join(root, '.stronghold', 'governance.yml');
    const auditLogPath = path.join(root, '.stronghold', 'audit.jsonl');
    fs.mkdirSync(path.dirname(governancePath), { recursive: true });
    fs.writeFileSync(governancePath, 'version: 1\n', 'utf8');

    await expect(
      acceptGovernanceRisk({
        governancePath,
        auditLogPath,
        scan: createScan({
          finding: createFinding({
            policyViolations: [
              {
                policyId: 'pol-001',
                policyName: 'Critical services must have backup',
                findingKey: 'backup_plan_exists::payment-db',
                nodeId: 'payment-db',
                serviceId: 'payment',
                severity: 'critical',
                message: 'payment-db violates policy.',
              },
            ],
          }),
        }),
        findingKey: 'backup_plan_exists::payment-db',
        acceptedBy: 'mehdi@example.com',
        justification: 'Test acceptance',
        expiresDays: 90,
        now: new Date('2026-04-08T00:00:00Z'),
      }),
    ).rejects.toThrow(/violates policy/i);
  });

  it('validates governance entries against the latest scan', () => {
    const result = validateGovernanceAgainstScan(
      {
        version: 1,
        ownership: {
          payment: {
            owner: 'team-backend',
            confirmed: true,
            confirmedAt: '2026-03-15T10:00:00Z',
            reviewCycleDays: 90,
          },
        },
        riskAcceptances: [
          {
            id: 'ra-001',
            findingKey: 'backup_plan_exists::payment-db',
            acceptedBy: 'mehdi@example.com',
            justification: 'Approved for staging',
            acceptedAt: '2026-03-01T00:00:00Z',
            expiresAt: '2026-09-01T00:00:00Z',
            severityAtAcceptance: 'high',
          },
        ],
        policies: [
          {
            id: 'pol-001',
            name: 'Critical services must have backup',
            description: 'Critical datastores must pass backup_plan_exists.',
            rule: 'backup_plan_exists',
            appliesTo: {
              serviceCriticality: 'critical',
              resourceRole: 'datastore',
            },
            severity: 'critical',
          },
        ],
      },
      createScan({
        governance: {
          riskAcceptances: [
            {
              id: 'ra-001',
              findingKey: 'backup_plan_exists::payment-db',
              acceptedBy: 'mehdi@example.com',
              justification: 'Approved for staging',
              acceptedAt: '2026-03-01T00:00:00Z',
              expiresAt: '2026-09-01T00:00:00Z',
              severityAtAcceptance: 'high',
              status: 'active',
            },
          ],
          score: {
            withAcceptances: { score: 80, grade: 'B' },
            withoutAcceptances: { score: 70, grade: 'C' },
            excludedFindings: 1,
          },
          policies: [
            {
              id: 'pol-001',
              name: 'Critical services must have backup',
              description: 'Critical datastores must pass backup_plan_exists.',
              rule: 'backup_plan_exists',
              appliesTo: {
                serviceCriticality: 'critical',
                resourceRole: 'datastore',
              },
              severity: 'critical',
            },
          ],
          policyViolations: [],
        },
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.ownership[0]?.status).toBe('ok');
    expect(result.riskAcceptances[0]?.status).toBe('ok');
    expect(result.policies[0]?.status).toBe('ok');
  });

  it('renders a governance overview with ownership and policy counts', () => {
    const governance: GovernanceConfig = {
      version: 1,
      ownership: {
        payment: {
          owner: 'team-backend',
          confirmed: true,
          confirmedAt: '2026-03-15T10:00:00Z',
          reviewCycleDays: 90,
        },
      },
      riskAcceptances: [],
      policies: [
        {
          id: 'pol-001',
          name: 'Critical services must have backup',
          description: 'Critical datastores must pass backup_plan_exists.',
          rule: 'backup_plan_exists',
          appliesTo: {
            serviceCriticality: 'critical',
            resourceRole: 'datastore',
          },
          severity: 'critical',
        },
      ],
    };

    const rendered = renderGovernanceOverview(
      governance,
      createScan({
        governance: {
          riskAcceptances: [],
          score: {
            withAcceptances: { score: 80, grade: 'B' },
            withoutAcceptances: { score: 70, grade: 'C' },
            excludedFindings: 0,
          },
          policies: governance.policies,
          policyViolations: [
            {
              policyId: 'pol-001',
              policyName: 'Critical services must have backup',
              findingKey: 'backup_plan_exists::payment-db',
              nodeId: 'payment-db',
              serviceId: 'payment',
              severity: 'critical',
              message: 'payment-db violates policy.',
            },
          ],
        },
      }),
      new Date('2026-04-08T00:00:00Z'),
    );

    expect(rendered).toContain('DR Governance - 2026-04-08');
    expect(rendered).toContain('payment');
    expect(rendered).toContain('pol-001');
    expect(rendered).toContain('1 policy violation');
  });
});

function createScan(
  overrides: {
    readonly finding?: ContextualFinding;
    readonly governance?: ScanResults['governance'];
  } = {},
): ScanResults {
  const service = createService();
  const finding = overrides.finding ?? createFinding();
  const posture = createPosture(service, finding);

  return {
    timestamp: '2026-04-08T00:00:00.000Z',
    provider: 'aws',
    regions: ['eu-west-1'],
    nodes: [],
    edges: [],
    analysis: {
      timestamp: '2026-04-08T00:00:00.000Z',
      totalNodes: 1,
      totalEdges: 0,
      spofs: [],
      criticalityScores: {},
      redundancyIssues: [],
      regionalRisks: [],
      circularDeps: [],
      cascadeChains: [],
      resilienceScore: 50,
    },
    validationReport: createValidationReport(),
    drpPlan: {
      version: '1',
      generatedAt: '2026-04-08T00:00:00.000Z',
      provider: 'aws',
      summary: {
        serviceCount: 1,
        criticalServiceCount: 1,
        estimatedRtoMinutes: null,
        estimatedRpoMinutes: null,
      },
      services: [],
      assumptions: [],
      metadata: {},
    },
    servicePosture: posture,
    ...(overrides.governance ? { governance: overrides.governance } : {}),
  };
}

function createService(): Service {
  return {
    id: 'payment',
    name: 'Payment',
    criticality: 'critical',
    owner: 'team-backend',
    governance: {
      owner: 'team-backend',
      ownerStatus: 'confirmed',
      confirmedAt: '2026-03-15T10:00:00Z',
      nextReviewAt: '2026-06-13T10:00:00.000Z',
    },
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1,
    },
    resources: [
      {
        nodeId: 'payment-db',
        role: 'datastore',
        detectionSource: {
          type: 'manual',
          file: '.stronghold/services.yml',
          confidence: 1,
        },
      },
    ],
    metadata: {},
  };
}

function createFinding(
  overrides: Partial<ContextualFinding> = {},
): ContextualFinding {
  return {
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
    ...overrides,
  };
}

function createPosture(service: Service, finding: ContextualFinding): ServicePosture {
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
          score: 80,
          grade: 'B',
          findingsCount: {
            critical: 0,
            high: 1,
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
          score: 80,
          grade: 'B',
          findingsCount: {
            critical: 0,
            high: 1,
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
    results: [
      {
        ruleId: 'backup_plan_exists',
        nodeId: 'payment-db',
        nodeName: 'payment-db',
        nodeType: 'database',
        status: 'fail',
        severity: 'high',
        category: 'backup',
        weight: 10,
        message: 'Missing backup plan',
        weightBreakdown: {
          severityWeight: 1,
          criticalityWeight: 1,
          blastRadiusWeight: 1,
          directDependentCount: 0,
        },
      },
    ],
    score: 70,
    scoreBreakdown: {
      overall: 70,
      byCategory: {
        backup: 70,
        redundancy: 100,
        failover: 100,
        detection: 100,
        recovery: 100,
        replication: 100,
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

function createTempDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
