import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ProofOfRecoveryResult,
  Recommendation,
  ScenarioAnalysis,
  ServicePostureService,
  ServiceRecommendationProjection,
} from '@stronghold-dr/core';

import { renderStatusSnapshot } from '../commands/status.js';
import {
  calculateDebtChangePercent,
  renderExecutiveSummary,
  resolveExecutiveTrend,
} from '../output/executive-summary.js';
import { createProgram } from '../index.js';
import { createDemoResults, createTempDirectory } from './test-utils.js';

describe('renderExecutiveSummary', () => {
  it('renders worst exposed services with a maximum of three lines', () => {
    const rendered = renderExecutiveSummary({
      score: 45,
      grade: 'D',
      proofOfRecovery: createProofOfRecovery([
        { serviceId: 'database', criticality: 'critical', hasTestedEvidence: false, totalRuleCount: 3 },
        { serviceId: 'storage', criticality: 'high', hasTestedEvidence: false, totalRuleCount: 2 },
        { serviceId: 'dns', criticality: 'high', hasTestedEvidence: false, totalRuleCount: 1 },
        { serviceId: 'cache', criticality: 'medium', hasTestedEvidence: false, totalRuleCount: 1 },
      ]),
      services: [
        createServiceEntry('database', 'F', 19, 'backup', 'backup_plan_exists', 'Automated backups are not configured.'),
        createServiceEntry('storage', 'F', 26, 'replication', 's3_replication_active', 'Bucket replication is not configured.'),
        createServiceEntry('dns', 'F', 0, 'redundancy', 'route53_failover_configured', 'Single target only.'),
        createServiceEntry('cache', 'D', 39, 'failover', 'failover_missing', 'Failover path is missing.'),
      ],
      scenarioAnalysis: createScenarioAnalysis(),
      scenariosCovered: 0,
      scenariosTotal: 13,
      drDebt: 680,
      drDebtChange: 12,
      trend: 'stable',
      nextAction: createRecommendation('Attach prod-db-primary to AWS Backup', 'safe', 4),
    });

    expect(rendered).toContain('Stronghold DR Intelligence');
    expect(rendered).toContain('Worst exposed');
    expect(rendered.match(/✗/g)).toHaveLength(3);
    expect(rendered).not.toMatch(/[╔╗╚╝║═]/);
  });

  it('shows a no-services message and N/A proof when no services are detected', () => {
    const rendered = renderExecutiveSummary({
      score: 0,
      grade: 'F',
      proofOfRecovery: {
        proofOfRecovery: null,
        proofOfRecoveryAll: null,
        observedCoverage: 0,
        perService: [],
      },
      services: [],
      scenariosCovered: 0,
      scenariosTotal: 0,
      drDebt: 0,
      drDebtChange: null,
      trend: 'first_scan',
      nextAction: null,
    });

    expect(rendered).toContain('N/A tested');
    expect(rendered).toContain("No services detected - run 'stronghold services detect'");
    expect(rendered).not.toContain('Worst exposed');
  });

  it('replaces worst exposed with an all-healthy message when every service is A/B', () => {
    const rendered = renderExecutiveSummary({
      score: 92,
      grade: 'A',
      proofOfRecovery: createProofOfRecovery([
        { serviceId: 'payment', criticality: 'critical', hasTestedEvidence: true, totalRuleCount: 2 },
        { serviceId: 'api', criticality: 'high', hasTestedEvidence: true, totalRuleCount: 2 },
      ]),
      services: [
        createServiceEntry('payment', 'A', 96, 'backup', 'backup_plan_exists', 'Healthy'),
        createServiceEntry('api', 'B', 82, 'detection', 'monitoring_configured', 'Healthy'),
      ],
      scenariosCovered: 5,
      scenariosTotal: 5,
      drDebt: 0,
      drDebtChange: null,
      trend: 'improving',
      nextAction: null,
    });

    expect(rendered).toContain('All services healthy');
    expect(rendered).not.toContain('Worst exposed');
  });

  it('reports risk and impact for the next action', () => {
    const rendered = renderExecutiveSummary({
      score: 45,
      grade: 'D',
      proofOfRecovery: createProofOfRecovery([
        { serviceId: 'database', criticality: 'critical', hasTestedEvidence: false, totalRuleCount: 3 },
      ]),
      services: [createServiceEntry('database', 'D', 45, 'backup', 'backup_plan_exists', 'Automated backups are not configured.')],
      scenariosCovered: 0,
      scenariosTotal: 3,
      drDebt: 120,
      drDebtChange: 10,
      trend: 'stable',
      nextAction: createRecommendation('Attach prod-db-primary to AWS Backup', 'safe', 4),
    });

    expect(rendered).toContain('Next action');
    expect(rendered).toContain('Attach prod-db-primary to AWS Backup');
    expect(rendered).toContain('+4 points');
  });

  it('shares debt delta and trend helpers across commands', () => {
    expect(calculateDebtChangePercent(680, 607)).toBe(12);
    expect(calculateDebtChangePercent(0, 607)).toBeNull();
    expect(resolveExecutiveTrend(1, 'stable')).toBe('first_scan');
    expect(resolveExecutiveTrend(2, 'degrading')).toBe('degrading');
  });
});

describe('executive summary integration', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
  });

  it('renders the executive summary before the existing status detail', async () => {
    const results = await createDemoResults('startup');

    const rendered = renderStatusSnapshot(results, 'missing-audit.jsonl', []);

    expect(rendered.indexOf('Stronghold DR Intelligence')).toBeLessThan(
      rendered.indexOf('DR Posture -'),
    );
    expect(rendered).toContain('Score:');
    expect(rendered).toContain('Run \'stronghold scan\' to refresh.');
  });

  it('demo command prints the executive summary before recommendations', async () => {
    const cwd = createTempDirectory('stronghold-demo-summary-');
    process.chdir(cwd);
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    await createProgram().parseAsync(['node', 'stronghold', 'demo', '--scenario', 'startup']);

    const output = writes.join('');
    expect(output).toContain('Stronghold DR Intelligence');
    expect(output).toContain('0% tested');
    expect(output.indexOf('Stronghold DR Intelligence')).toBeLessThan(output.indexOf('Top Recommendations'));
  });
});

function createProofOfRecovery(
  services: ReadonlyArray<{
    readonly serviceId: string;
    readonly criticality: ProofOfRecoveryResult['perService'][number]['criticality'];
    readonly hasTestedEvidence: boolean;
    readonly totalRuleCount: number;
  }>,
): ProofOfRecoveryResult {
  const criticalServices = services.filter((service) => service.criticality === 'critical');
  const allTested = services.filter((service) => service.hasTestedEvidence).length;
  const criticalTested = criticalServices.filter((service) => service.hasTestedEvidence).length;

  return {
    proofOfRecovery:
      criticalServices.length === 0
        ? null
        : Math.round((criticalTested / criticalServices.length) * 100),
    proofOfRecoveryAll:
      services.length === 0
        ? null
        : Math.round((allTested / services.length) * 100),
    observedCoverage: 73,
    perService: services.map((service) => ({
      serviceId: service.serviceId,
      serviceName: service.serviceId,
      criticality: service.criticality,
      hasTestedEvidence: service.hasTestedEvidence,
      hasObservedEvidence: !service.hasTestedEvidence && service.totalRuleCount > 0,
      testedRuleCount: service.hasTestedEvidence ? 1 : 0,
      totalRuleCount: service.totalRuleCount,
    })),
  };
}

function createServiceEntry(
  id: string,
  grade: 'A' | 'B' | 'C' | 'D' | 'F',
  score: number,
  category: ServicePostureService['score']['findings'][number]['category'],
  ruleId: string,
  message: string,
): ServicePostureService {
  return {
    service: {
      id,
      name: id,
      criticality: id === 'database' ? 'critical' : 'high',
      detectionSource: {
        type: 'manual',
        file: '.stronghold/services.yml',
        confidence: 1.0,
      },
      resources: [
        {
          nodeId: `${id}-node`,
          detectionSource: {
            type: 'manual',
            file: '.stronghold/services.yml',
            confidence: 1.0,
          },
        },
      ],
      metadata: {},
    },
    score: {
      serviceId: id,
      serviceName: id,
      resourceCount: 1,
      criticality: id === 'database' ? 'critical' : 'high',
      detectionSource: {
        type: 'manual',
        file: '.stronghold/services.yml',
        confidence: 1.0,
      },
      score,
      grade,
      findingsCount: {
        critical: grade === 'F' ? 1 : 0,
        high: grade === 'D' ? 1 : 0,
        medium: 0,
        low: 0,
      },
      findings: grade === 'A' || grade === 'B'
        ? []
        : [
            {
              ruleId,
              nodeId: `${id}-node`,
              nodeName: `${id}-node`,
              nodeType: 'DATABASE',
              status: 'fail',
              severity: grade === 'F' ? 'critical' : 'high',
              category,
              weight: 1,
              message,
              serviceId: id,
              serviceName: id,
              resourceRole: 'datastore',
              weightBreakdown: {
                severityWeight: 1,
                criticalityWeight: 1,
                blastRadiusWeight: 1,
                directDependentCount: 0,
                evidenceType: 'observed',
                evidenceConfidence: 0.85,
              },
            },
          ],
      coverageGaps: [],
    },
    contextualFindings: [],
    recommendations: [],
  };
}

function createScenarioAnalysis(): ScenarioAnalysis {
  return {
    scenarios: [
      {
        id: 'region-failure',
        name: 'Region failure',
        description: 'Test',
        type: 'region_failure',
        disruption: {
          affectedNodes: ['dns-node'],
          selectionCriteria: 'test',
        },
        coverage: {
          verdict: 'degraded',
          details: [
            {
              serviceId: 'dns',
              serviceName: 'dns',
              verdict: 'degraded',
              reason: 'Runbook references stale resources: dns-primary',
              missingCapabilities: [],
              evidenceLevel: 'observed',
            },
          ],
          summary: '1 degraded',
        },
      },
    ],
    defaultScenarioIds: ['region-failure'],
    summary: {
      total: 13,
      covered: 0,
      partiallyCovered: 0,
      uncovered: 13,
      degraded: 0,
    },
  };
}

function createRecommendation(
  title: string,
  risk: Recommendation['risk'],
  scoreDelta: number,
): Recommendation | ServiceRecommendationProjection {
  return {
    id: title.toLowerCase().replace(/\s+/g, '-'),
    title,
    description: title,
    category: 'backup',
    severity: 'high',
    targetNode: 'database-node',
    targetNodeName: 'database-node',
    impact: {
      scoreDelta,
      affectedRules: ['backup_plan_exists'],
    },
    risk,
    riskReason: 'safe',
    remediation: {
      command: 'aws backup create-backup-plan',
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '15m',
      prerequisites: [],
    },
  };
}
