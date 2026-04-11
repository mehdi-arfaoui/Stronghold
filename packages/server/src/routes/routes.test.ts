import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServerLogger } from '../adapters/server-logger.js';
import { createApp } from '../app.js';
import type { ServerConfig } from '../config/env.js';
import { ServerError } from '../errors/server-error.js';
import type { DriftService } from '../services/drift-service.js';
import { PrismaAuditLogger } from '../services/prisma-audit-logger.js';
import type { ScanService } from '../services/scan-service.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

function createTestApp(options?: {
  readonly dbHealthy?: boolean;
  readonly scanService?: Partial<ScanService>;
  readonly driftService?: Partial<DriftService>;
}): ReturnType<typeof createApp> {
  const config: ServerConfig = {
    port: 3000,
    databaseUrl: 'postgresql://stronghold:stronghold@localhost:5432/stronghold',
    nodeEnv: 'test',
    corsOrigin: 'http://localhost:5173',
    corsOrigins: ['http://localhost:5173'],
    logLevel: 'error',
    servicesFilePath: 'C:\\temp\\.stronghold\\services.yml',
    governanceFilePath: 'C:\\temp\\.stronghold\\governance.yml',
  };
  const logger = new ServerLogger(config);
  const prisma = {
    $queryRaw: options?.dbHealthy === false ? vi.fn().mockRejectedValue(new Error('db down')) : vi.fn().mockResolvedValue([{ ok: 1 }]),
  } as unknown as PrismaClient;
  const scanService = {
    createScan: vi.fn().mockResolvedValue(VALID_UUID),
    listScans: vi.fn().mockResolvedValue({
      scans: [
        {
          id: VALID_UUID,
          provider: 'aws',
          regions: ['eu-west-1'],
          status: 'COMPLETED',
          resourceCount: 10,
          edgeCount: 8,
          score: 82,
          grade: 'B',
          errorMessage: null,
          createdAt: new Date('2026-03-27T15:00:00.000Z'),
          updatedAt: new Date('2026-03-27T15:00:00.000Z'),
        },
      ],
      nextCursor: '550e8400-e29b-41d4-a716-446655440001',
    }),
    getScanSummary: vi.fn().mockResolvedValue({
      id: VALID_UUID,
      provider: 'aws',
      regions: ['eu-west-1'],
      status: 'COMPLETED',
      resourceCount: 10,
      edgeCount: 8,
      score: 82,
      grade: 'B',
      errorMessage: null,
      createdAt: new Date('2026-03-27T15:00:00.000Z'),
      updatedAt: new Date('2026-03-27T15:00:00.000Z'),
    }),
    getScanData: vi.fn().mockResolvedValue({
      nodes: [],
      edges: [],
      analysis: {},
      validationReport: {},
    }),
    deleteScan: vi.fn().mockResolvedValue(true),
    renderValidationReport: vi.fn(),
    getValidationSummary: vi.fn(),
    generatePlan: vi.fn(),
    getLatestPlan: vi.fn(),
    validatePlan: vi.fn(),
    getLatestServices: vi.fn().mockResolvedValue({
      scanId: VALID_UUID,
      generatedAt: '2026-03-27T15:00:00.000Z',
      services: [],
      unassigned: {
        score: null,
        resourceCount: 0,
        contextualFindings: [],
        recommendations: [],
      },
    }),
    getServiceDetail: vi.fn().mockResolvedValue({
      scanId: VALID_UUID,
      generatedAt: '2026-03-27T15:00:00.000Z',
      service: {
        service: {
          id: 'payment',
          name: 'Payment',
          criticality: 'critical',
          detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1 },
          resources: [],
          metadata: {},
        },
        score: {
          serviceId: 'payment',
          serviceName: 'Payment',
          resourceCount: 0,
          criticality: 'critical',
          detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1 },
          score: 34,
          grade: 'D',
          findingsCount: { critical: 1, high: 0, medium: 0, low: 0 },
          findings: [],
          coverageGaps: [],
        },
        contextualFindings: [],
        recommendations: [],
      },
      unassignedResourceCount: 0,
    }),
    listScenarios: vi.fn().mockResolvedValue({
      scanId: VALID_UUID,
      generatedAt: '2026-03-27T15:00:00.000Z',
      scenarios: [],
      defaultScenarioIds: [],
      summary: {
        total: 0,
        covered: 0,
        partiallyCovered: 0,
        uncovered: 0,
        degraded: 0,
      },
    }),
    getScenarioDetail: vi.fn().mockResolvedValue({
      scanId: VALID_UUID,
      generatedAt: '2026-03-27T15:00:00.000Z',
      scenario: {
        id: 'az-failure-eu-west-1a',
        name: 'AZ failure - eu-west-1a',
        description: 'Removes every resource placed in eu-west-1a and evaluates the downstream disruption impact.',
        type: 'az_failure',
        disruption: {
          affectedNodes: ['payment-db'],
          selectionCriteria: 'All resources in eu-west-1a',
        },
        impact: {
          directlyAffected: [],
          cascadeAffected: [],
          totalAffectedNodes: 0,
          totalAffectedServices: [],
          serviceImpact: [],
        },
        coverage: {
          verdict: 'uncovered',
          details: [],
          summary: 'No recovery path exists.',
        },
      },
      summary: {
        total: 1,
        covered: 0,
        partiallyCovered: 0,
        uncovered: 1,
        degraded: 0,
      },
    }),
    listEvidence: vi.fn().mockResolvedValue({
      scanId: VALID_UUID,
      generatedAt: '2026-03-27T15:00:00.000Z',
      evidence: [],
    }),
    listHistory: vi.fn().mockResolvedValue({
      snapshots: [],
      total: 0,
    }),
    getHistoryTrend: vi.fn().mockResolvedValue({
      snapshots: [],
      trend: {
        global: {
          direction: 'stable',
          scoreTrend: [],
          proofOfRecoveryTrend: [],
          observedCoverageTrend: [],
          findingTrend: [],
          scenarioCoverageTrend: [],
        },
        services: [],
        evidenceTrend: {
          testedCount: [],
          expiredCount: [],
        },
        highlights: [],
      },
    }),
    getServiceHistory: vi.fn().mockResolvedValue({
      serviceId: 'payment',
      serviceName: 'Payment',
      snapshots: [],
      lifecycles: [],
      trend: null,
    }),
    getExpiringEvidence: vi.fn().mockResolvedValue({
      scanId: VALID_UUID,
      generatedAt: '2026-03-27T15:00:00.000Z',
      evidence: [],
    }),
    addEvidence: vi.fn().mockResolvedValue({
      id: 'evidence-1',
      type: 'tested',
      source: { origin: 'test', testType: 'restore-test', testDate: '2026-03-27T15:00:00.000Z' },
      subject: { nodeId: 'payment-db', serviceId: 'payment' },
      observation: {
        key: 'restore-test',
        value: 'success',
        expected: 'success',
        description: 'Manual restore-test evidence recorded for payment-db.',
      },
      timestamp: '2026-03-27T15:00:00.000Z',
      expiresAt: '2026-06-25T15:00:00.000Z',
      testResult: {
        status: 'success',
        executor: 'unknown',
      },
    }),
    redetectLatestServices: vi.fn().mockResolvedValue({
      scanId: VALID_UUID,
      generatedAt: '2026-03-27T15:00:00.000Z',
      services: [],
      unassigned: {
        score: null,
        resourceCount: 0,
        contextualFindings: [],
        recommendations: [],
      },
    }),
    getLatestGovernance: vi.fn().mockResolvedValue({
      generatedAt: '2026-03-27T15:00:00.000Z',
      ownership: [
        {
          serviceId: 'payment',
          serviceName: 'Payment',
          owner: 'team-backend',
          ownerStatus: 'confirmed',
          confirmedAt: '2026-03-15T10:00:00.000Z',
          nextReviewAt: '2026-06-13T10:00:00.000Z',
        },
      ],
      riskAcceptances: [],
      policies: [],
      violations: [],
      score: null,
    }),
    listGovernanceAcceptances: vi.fn().mockResolvedValue({
      generatedAt: '2026-03-27T15:00:00.000Z',
      acceptances: [],
    }),
    listGovernancePolicies: vi.fn().mockResolvedValue({
      generatedAt: '2026-03-27T15:00:00.000Z',
      policies: [],
    }),
    acceptGovernanceRisk: vi.fn().mockRejectedValue(
      new ServerError('Governance file editing is not available over the API.', {
        code: 'NOT_IMPLEMENTED',
        status: 501,
      }),
    ),
    ...options?.scanService,
  } as unknown as ScanService;
  const driftService = {
    checkDrift: vi.fn(),
    listDriftEvents: vi.fn().mockResolvedValue([]),
    ...options?.driftService,
  } as unknown as DriftService;
  const auditLogger = {
    log: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({
      entries: [],
    }),
  } as unknown as PrismaAuditLogger;

  return createApp({
    config,
    prisma,
    logger,
    scanService,
    driftService,
    auditLogger,
  });
}

describe('server routes', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/health returns status ok', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('GET /api/health/db returns 200 when the database is reachable', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/health/db');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /api/health/db returns 503 when the database is unreachable', async () => {
    const app = createTestApp({ dbHealthy: false });

    const response = await request(app).get('/api/health/db');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
  });

  it('POST /api/scans returns 202 for a valid body', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/scans')
      .send({ provider: 'aws', regions: ['eu-west-1'] });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ scanId: VALID_UUID, status: 'PENDING' });
  });

  it('POST /api/scans returns 400 without a body', async () => {
    const app = createTestApp();

    const response = await request(app).post('/api/scans');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('POST /api/scans returns 400 for an invalid provider', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/scans')
      .send({ provider: 'azure', regions: ['eu-west-1'] });

    expect(response.status).toBe(400);
  });

  it('POST /api/scans returns 400 for empty regions', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/scans')
      .send({ provider: 'aws', regions: [] });

    expect(response.status).toBe(400);
  });

  it('GET /api/scans returns a paginated scan list', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/scans?limit=20');

    expect(response.status).toBe(200);
    expect(response.body.scans).toHaveLength(1);
    expect(response.body.nextCursor).toBe('550e8400-e29b-41d4-a716-446655440001');
  });

  it('GET /api/scans/not-a-uuid returns 400', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/scans/not-a-uuid');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('GET /api/scans/:id returns 404 when the scan does not exist', async () => {
    const app = createTestApp({
      scanService: {
        getScanSummary: vi.fn().mockRejectedValue(
          new ServerError('Scan not found', { code: 'SCAN_NOT_FOUND', status: 404 }),
        ),
      },
    });

    const response = await request(app).get(`/api/scans/${VALID_UUID}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('SCAN_NOT_FOUND');
  });

  it('DELETE /api/scans/:id returns 204 when the scan is deleted', async () => {
    const app = createTestApp();

    const response = await request(app).delete(`/api/scans/${VALID_UUID}`);

    expect(response.status).toBe(204);
  });

  it('GET /api/audit returns paginated audit entries', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/audit?limit=20');

    expect(response.status).toBe(200);
    expect(response.body.entries).toEqual([]);
  });

  it('GET /api/services returns the latest persisted services snapshot', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/services');

    expect(response.status).toBe(200);
    expect(response.body.scanId).toBe(VALID_UUID);
    expect(Array.isArray(response.body.services)).toBe(true);
  });

  it('GET /api/services/:id returns a specific service detail', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/services/payment');

    expect(response.status).toBe(200);
    expect(response.body.service.service.id).toBe('payment');
  });

  it('GET /api/governance returns the latest governance payload', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/governance');

    expect(response.status).toBe(200);
    expect(response.body.ownership[0]?.serviceId).toBe('payment');
  });

  it('GET /api/governance/acceptances returns governance acceptances', async () => {
    const app = createTestApp({
      scanService: {
        listGovernanceAcceptances: vi.fn().mockResolvedValue({
          generatedAt: '2026-03-27T15:00:00.000Z',
          acceptances: [
            {
              id: 'ra-001',
              findingKey: 'backup_plan_exists::payment-db',
              acceptedBy: 'mehdi@stronghold.software',
              justification: 'Accepted for testing.',
              acceptedAt: '2026-03-27T15:00:00.000Z',
              expiresAt: '2026-06-25T15:00:00.000Z',
              severityAtAcceptance: 'high',
              status: 'active',
            },
          ],
        }),
      },
    });

    const response = await request(app).get('/api/governance/acceptances');

    expect(response.status).toBe(200);
    expect(response.body.acceptances[0]?.id).toBe('ra-001');
  });

  it('GET /api/governance/policies returns governance policies', async () => {
    const app = createTestApp({
      scanService: {
        listGovernancePolicies: vi.fn().mockResolvedValue({
          generatedAt: '2026-03-27T15:00:00.000Z',
          policies: [
            {
              policy: {
                id: 'pol-001',
                name: 'Critical services must have backup',
                description: 'Critical datastores need backup coverage.',
                rule: 'backup_plan_exists',
                appliesTo: {
                  service_criticality: 'critical',
                  resource_role: 'datastore',
                },
                severity: 'critical',
              },
              violationCount: 1,
              violations: [
                {
                  policyId: 'pol-001',
                  policyName: 'Critical services must have backup',
                  findingKey: 'backup_plan_exists::payment-db',
                  nodeId: 'payment-db',
                  serviceId: 'payment',
                  severity: 'critical',
                  message: 'backup_plan_exists violates policy pol-001.',
                },
              ],
            },
          ],
        }),
      },
    });

    const response = await request(app).get('/api/governance/policies');

    expect(response.status).toBe(200);
    expect(response.body.policies[0]?.policy.id).toBe('pol-001');
    expect(response.body.policies[0]?.violationCount).toBe(1);
  });

  it('POST /api/governance/accept returns 501 when server-side governance editing is unavailable', async () => {
    const app = createTestApp();

    const response = await request(app).post('/api/governance/accept').send({
      finding: 'backup_plan_exists::payment-db',
      by: 'mehdi@stronghold.software',
      justification: 'Accepted for testing.',
      expires: 90,
    });

    expect(response.status).toBe(501);
    expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('GET /api/history returns persisted posture snapshots', async () => {
    const app = createTestApp({
      scanService: {
        listHistory: vi.fn().mockResolvedValue({
          snapshots: [{ id: 'snapshot-1', timestamp: '2026-03-27T15:00:00.000Z' }],
          total: 1,
        }),
      },
    });

    const response = await request(app).get('/api/history?limit=10');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.snapshots[0]?.id).toBe('snapshot-1');
  });

  it('GET /api/history/trend returns trend data and highlights', async () => {
    const app = createTestApp({
      scanService: {
        getHistoryTrend: vi.fn().mockResolvedValue({
          snapshots: [],
          trend: {
            global: {
              direction: 'degrading',
              scoreTrend: [],
              proofOfRecoveryTrend: [],
              observedCoverageTrend: [],
              findingTrend: [],
              scenarioCoverageTrend: [],
            },
            services: [],
            evidenceTrend: {
              testedCount: [],
              expiredCount: [],
            },
            highlights: [
              {
                type: 'score_degraded',
                message: 'Global score dropped by 4 points (72 -> 68).',
                severity: 'warning',
              },
            ],
          },
        }),
      },
    });

    const response = await request(app).get('/api/history/trend');

    expect(response.status).toBe(200);
    expect(response.body.trend.global.direction).toBe('degrading');
    expect(response.body.trend.highlights[0]?.type).toBe('score_degraded');
  });

  it('GET /api/history/service/:id returns per-service history', async () => {
    const app = createTestApp({
      scanService: {
        getServiceHistory: vi.fn().mockResolvedValue({
          serviceId: 'payment',
          serviceName: 'Payment',
          snapshots: [
            {
              timestamp: '2026-03-27T15:00:00.000Z',
              score: 34,
              grade: 'D',
              findingCount: 5,
              criticalFindingCount: 1,
              resourceCount: 3,
              debt: 680,
            },
          ],
          lifecycles: [],
          trend: {
            serviceId: 'payment',
            serviceName: 'Payment',
            direction: 'degrading',
            scoreTrend: [],
            debtTrend: [],
          },
        }),
      },
    });

    const response = await request(app).get('/api/history/service/payment');

    expect(response.status).toBe(200);
    expect(response.body.serviceId).toBe('payment');
    expect(response.body.snapshots[0]?.score).toBe(34);
  });

  it('GET /api/scenarios returns the latest persisted scenario coverage analysis', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/scenarios');

    expect(response.status).toBe(200);
    expect(response.body.scanId).toBe(VALID_UUID);
    expect(Array.isArray(response.body.scenarios)).toBe(true);
  });

  it('GET /api/scenarios/:id returns a specific scenario detail', async () => {
    const app = createTestApp();

    const response = await request(app).get('/api/scenarios/az-failure-eu-west-1a');

    expect(response.status).toBe(200);
    expect(response.body.scenario.id).toBe('az-failure-eu-west-1a');
  });

  it('GET /api/evidence returns the latest evidence payload', async () => {
    const app = createTestApp({
      scanService: {
        listEvidence: vi.fn().mockResolvedValue({
          scanId: VALID_UUID,
          generatedAt: '2026-03-27T15:00:00.000Z',
          evidence: [{ id: 'evidence-1' }],
        }),
      },
    });

    const response = await request(app).get('/api/evidence?nodeId=payment-db');

    expect(response.status).toBe(200);
    expect(response.body.scanId).toBe(VALID_UUID);
    expect(response.body.evidence[0]?.id).toBe('evidence-1');
  });

  it('GET /api/evidence/expiring returns expiring evidence entries', async () => {
    const app = createTestApp({
      scanService: {
        getExpiringEvidence: vi.fn().mockResolvedValue({
          scanId: VALID_UUID,
          generatedAt: '2026-03-27T15:00:00.000Z',
          evidence: [{ id: 'evidence-1' }],
        }),
      },
    });

    const response = await request(app).get('/api/evidence/expiring');

    expect(response.status).toBe(200);
    expect(response.body.evidence).toHaveLength(1);
  });

  it('POST /api/evidence creates tested evidence and returns 201', async () => {
    const app = createTestApp();

    const response = await request(app).post('/api/evidence').send({
      nodeId: 'payment-db',
      type: 'restore-test',
      result: 'success',
    });

    expect(response.status).toBe(201);
    expect(response.body.type).toBe('tested');
    expect(response.body.subject.nodeId).toBe('payment-db');
  });

  it('POST /api/services/detect triggers re-detection on the latest scan', async () => {
    const app = createTestApp();

    const response = await request(app).post('/api/services/detect');

    expect(response.status).toBe(200);
    expect(response.body.scanId).toBe(VALID_UUID);
  });

  it('GET /api/scans/:id/report redacts JSON output when requested', async () => {
    const app = createTestApp({
      scanService: {
        renderValidationReport: vi.fn().mockResolvedValue({
          message: 'sg-0abc1234def56789 on 10.20.30.40',
        }),
      },
    });

    const response = await request(app).get(`/api/scans/${VALID_UUID}/report?format=json&redact=true`);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('sg-****6789 on 10.***.***.**');
  });

  it('GET /api/scans/:id/report/summary redacts summary output when requested', async () => {
    const app = createTestApp({
      scanService: {
        getValidationSummary: vi.fn().mockResolvedValue({
          score: 82,
          grade: 'B',
          categories: {},
          topFailures: [
            {
              ruleId: 'sg-open',
              nodeId: 'sg-0abc1234def56789',
              nodeName: 'sg-0abc1234def56789',
              severity: 'high',
              message: '10.20.30.40 is reachable',
            },
          ],
        }),
      },
    });

    const response = await request(app).get(
      `/api/scans/${VALID_UUID}/report/summary?redact=true`,
    );

    expect(response.status).toBe(200);
    expect(response.body.topFailures[0]?.nodeId).toBe('sg-****6789');
    expect(response.body.topFailures[0]?.message).toBe('10.***.***.** is reachable');
  });
});
