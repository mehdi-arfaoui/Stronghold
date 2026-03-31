import type { PrismaClient } from '@prisma/client';
import type {
  DRPlan,
  DriftReport,
  InfraNodeAttrs,
  ScanEdge,
  ValidationReport,
} from '@stronghold-dr/core';
import { describe, expect, it, vi } from 'vitest';

import {
  PrismaScanRepository,
  type SaveScanParams,
} from './prisma-scan-repository.js';
import type { SerializedGraphAnalysis } from '../services/analysis-serialization.js';

function createPrismaMock() {
  const scan = {
    create: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  };
  const scanData = {
    upsert: vi.fn(),
  };
  const report = {
    create: vi.fn(),
    findFirst: vi.fn(),
  };
  const dRPlan = {
    create: vi.fn(),
    findFirst: vi.fn(),
  };
  const planValidation = {
    create: vi.fn(),
  };
  const driftEvent = {
    create: vi.fn(),
    findMany: vi.fn(),
  };
  const transactionClient = {
    scan,
    scanData,
    report,
    dRPlan,
    planValidation,
    driftEvent,
  };
  const $transaction = vi.fn(async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
    callback(transactionClient),
  );

  return {
    prisma: {
      ...transactionClient,
      $transaction,
    } as unknown as PrismaClient,
    mocks: {
      $transaction,
      scan,
      scanData,
      report,
      dRPlan,
      planValidation,
      driftEvent,
    },
  };
}

function createNode(id = 'node-1'): InfraNodeAttrs {
  return {
    id,
    name: 'payments-db',
    type: 'DATABASE',
    provider: 'aws',
    tags: {},
    metadata: {},
  };
}

function createEdge(): ScanEdge {
  return {
    source: 'node-1',
    target: 'node-2',
    type: 'DEPENDS_ON',
  };
}

function createAnalysis(): SerializedGraphAnalysis {
  return {
    timestamp: '2026-03-27T15:00:00.000Z',
    totalNodes: 2,
    totalEdges: 1,
    spofs: [],
    criticalityScores: { 'node-1': 80 },
    redundancyIssues: [],
    regionalRisks: [],
    circularDeps: [],
    cascadeChains: [],
    resilienceScore: 82,
  };
}

function createValidationReport(): ValidationReport {
  return {
    timestamp: '2026-03-27T15:00:00.000Z',
    totalChecks: 2,
    passed: 1,
    failed: 1,
    warnings: 0,
    skipped: 0,
    errors: 0,
    results: [],
    score: 82,
    scoreBreakdown: {
      overall: 82,
      byCategory: {
        backup: 80,
        redundancy: 90,
        failover: 75,
        detection: 85,
        recovery: 82,
        replication: 80,
      },
      grade: 'B',
      weakestCategory: 'failover',
      scoringMethod: 'weighted',
      disclaimer: 'tests only',
    },
    criticalFailures: [],
    scannedResources: 2,
  };
}

function createPlan(): DRPlan {
  return {
    id: 'plan-1',
    version: '1.0.0',
    generated: '2026-03-27T15:00:00.000Z',
    infrastructureHash: 'hash-123',
    provider: 'aws',
    regions: ['eu-west-1'],
    services: [
      {
        name: 'payments',
        criticality: 'critical',
        rtoTarget: '15m',
        rpoTarget: '5m',
        components: [
          {
            resourceId: 'node-1',
            resourceType: 'DATABASE',
            name: 'payments-db',
            region: 'eu-west-1',
            recoveryStrategy: 'failover',
            recoverySteps: [
              {
                action: 'promote_replica',
                target: 'node-1',
                description: 'Promote the standby replica.',
                timeout: '15m',
              },
            ],
            estimatedRTO: '15m',
            estimatedRPO: '5m',
            dependencies: [],
            risks: [],
          },
        ],
        validationTests: [
          {
            name: 'payments connectivity',
            type: 'connectivity',
            target: 'payments-db',
            description: 'Check connectivity',
            timeout: '1m',
          },
        ],
        estimatedRTO: '15m',
        estimatedRPO: '5m',
        recoveryOrder: ['node-1'],
      },
    ],
    metadata: {
      totalResources: 2,
      coveredResources: 1,
      uncoveredResources: ['node-2'],
      worstCaseRTO: '15m',
      averageRPO: '5m',
      stale: false,
    },
  };
}

function createSaveScanParams(): SaveScanParams {
  return {
    scanId: '550e8400-e29b-41d4-a716-446655440000',
    provider: 'aws',
    region: 'eu-west-1',
    timestamp: new Date('2026-03-27T15:00:00.000Z'),
    nodes: [createNode()],
    edges: [createEdge()],
    metadata: {},
    regions: ['eu-west-1'],
    analysis: createAnalysis(),
    validationReport: createValidationReport(),
  };
}

function createDriftReport(): DriftReport {
  return {
    scanIdBefore: 'baseline-scan',
    scanIdAfter: 'current-scan',
    timestamp: new Date('2026-03-27T15:00:00.000Z'),
    changes: [
      {
        id: 'resource_removed:node-1',
        category: 'resource_removed',
        severity: 'critical',
        resourceId: 'node-1',
        resourceType: 'DATABASE',
        field: 'resource',
        previousValue: 'payments-db',
        currentValue: null,
        description: 'payments-db was removed',
        drImpact: 'Regenerate the DR plan.',
        affectedServices: ['payments'],
      },
    ],
    summary: {
      total: 1,
      bySeverity: {
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
      byCategory: {
        backup_changed: 0,
        redundancy_changed: 0,
        network_changed: 0,
        security_changed: 0,
        resource_added: 0,
        resource_removed: 1,
        config_changed: 0,
        dependency_changed: 0,
      },
      drpStale: true,
    },
  };
}

describe('PrismaScanRepository', () => {
  it('saveScan creates a COMPLETED scan record', async () => {
    const { prisma, mocks } = createPrismaMock();
    const repository = new PrismaScanRepository(prisma);

    await repository.saveScan(createSaveScanParams());

    expect(mocks.scan.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'COMPLETED',
        }),
      }),
    );
  });

  it('saveScan stores ScanData in the same transaction', async () => {
    const { prisma, mocks } = createPrismaMock();
    const repository = new PrismaScanRepository(prisma);

    await repository.saveScan(createSaveScanParams());

    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.scanData.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          scanId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      }),
    );
  });

  it('getScan returns a scan by id', async () => {
    const { prisma, mocks } = createPrismaMock();
    const repository = new PrismaScanRepository(prisma);
    mocks.scan.findUnique.mockResolvedValue({
      id: 'scan-1',
      provider: 'aws',
      regions: ['eu-west-1'],
      createdAt: new Date('2026-03-27T15:00:00.000Z'),
      updatedAt: new Date('2026-03-27T15:00:00.000Z'),
      status: 'COMPLETED',
      resourceCount: 1,
      edgeCount: 1,
      score: 82,
      grade: 'B',
      errorMessage: null,
      scanData: {
        nodes: [createNode()],
        edges: [createEdge()],
      },
    });

    const scan = await repository.getScan('scan-1');

    expect(scan?.scanId).toBe('scan-1');
    expect(scan?.provider).toBe('aws');
  });

  it('getLatestScan returns the latest completed scan', async () => {
    const { prisma, mocks } = createPrismaMock();
    const repository = new PrismaScanRepository(prisma);
    mocks.scan.findFirst.mockResolvedValue({
      id: 'scan-2',
      provider: 'aws',
      regions: ['eu-west-1'],
      createdAt: new Date('2026-03-27T16:00:00.000Z'),
      updatedAt: new Date('2026-03-27T16:00:00.000Z'),
      status: 'COMPLETED',
      resourceCount: 1,
      edgeCount: 1,
      score: 90,
      grade: 'A',
      errorMessage: null,
      scanData: {
        nodes: [createNode()],
        edges: [createEdge()],
      },
    });

    const scan = await repository.getLatestScan('aws');

    expect(scan?.scanId).toBe('scan-2');
    expect(mocks.scan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: 'aws',
          status: 'COMPLETED',
        }),
      }),
    );
  });

  it('listScans respects the limit without loading heavy data', async () => {
    const { prisma, mocks } = createPrismaMock();
    const repository = new PrismaScanRepository(prisma);
    mocks.scan.findMany.mockResolvedValue([
      {
        id: 'scan-3',
        provider: 'aws',
        regions: ['eu-west-1'],
        status: 'COMPLETED',
        resourceCount: 10,
        edgeCount: 12,
        score: 82,
        grade: 'B',
        errorMessage: null,
        createdAt: new Date('2026-03-27T15:00:00.000Z'),
        updatedAt: new Date('2026-03-27T15:00:00.000Z'),
      },
    ]);

    const result = await repository.listScans({ limit: 1 });

    expect(result.scans).toHaveLength(1);
    expect(mocks.scan.findMany.mock.calls[0]?.[0]).not.toHaveProperty('include');
  });

  it('listScans applies the cursor when present', async () => {
    const { prisma, mocks } = createPrismaMock();
    const repository = new PrismaScanRepository(prisma);
    mocks.scan.findMany.mockResolvedValue([]);

    await repository.listScans({
      limit: 20,
      cursor: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(mocks.scan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: '550e8400-e29b-41d4-a716-446655440000' },
        skip: 1,
      }),
    );
  });

  it('saveDRPlan persists the plan with the requested format', async () => {
    const { prisma, mocks } = createPrismaMock();
    const repository = new PrismaScanRepository(prisma);
    mocks.dRPlan.create.mockResolvedValue({ id: 'plan-1' });

    const planId = await repository.saveDRPlan({
      scanId: 'scan-1',
      format: 'yaml',
      content: 'version: 1.0.0',
      plan: createPlan(),
      isValid: true,
    });

    expect(planId).toBe('plan-1');
    expect(mocks.dRPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          format: 'yaml',
        }),
      }),
    );
  });

  it('saveReport persists a report', async () => {
    const { prisma, mocks } = createPrismaMock();
    const repository = new PrismaScanRepository(prisma);
    mocks.report.create.mockResolvedValue({ id: 'report-1' });

    const reportId = await repository.saveReport({
      scanId: 'scan-1',
      type: 'validation',
      format: 'json',
      content: createValidationReport(),
      score: 82,
      grade: 'B',
    });

    expect(reportId).toBe('report-1');
    expect(mocks.report.create).toHaveBeenCalled();
  });

  it('saveDriftEvent persists a drift event', async () => {
    const { prisma, mocks } = createPrismaMock();
    const repository = new PrismaScanRepository(prisma);
    mocks.driftEvent.create.mockResolvedValue({ id: 'drift-1' });

    const eventId = await repository.saveDriftEvent('scan-1', createDriftReport());

    expect(eventId).toBe('drift-1');
    expect(mocks.driftEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scanId: 'scan-1',
          changeCount: 1,
          criticalCount: 1,
        }),
      }),
    );
  });

  it('deleteScan deletes the scan record', async () => {
    const { prisma, mocks } = createPrismaMock();
    const repository = new PrismaScanRepository(prisma);
    mocks.scan.deleteMany.mockResolvedValue({ count: 1 });

    const deleted = await repository.deleteScan('scan-1');

    expect(deleted).toBe(true);
    expect(mocks.scan.deleteMany).toHaveBeenCalledWith({
      where: { id: 'scan-1' },
    });
  });
});
