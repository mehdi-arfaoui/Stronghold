import { PrismaClient, ScanStatus } from '@prisma/client';
import type {
  DRPlan,
  DRPlanValidationReport,
  DriftReport,
  InfraNodeAttrs,
  ScanEdge,
  ScanRecord,
  ValidationReport,
} from '@stronghold-dr/core';
import { serializeDRPlan } from '@stronghold-dr/core';

import type { SerializedGraphAnalysis } from '../services/analysis-serialization.js';
import {
  deserializeStoredScanData,
  serializeStoredScanData,
  type ScanDataEncryptionService,
} from '../services/encryption.service.js';
import { toPrismaJson } from '../utils/prisma-json.js';

export interface ScanSummary {
  readonly id: string;
  readonly provider: string;
  readonly regions: readonly string[];
  readonly status: ScanStatus;
  readonly resourceCount: number;
  readonly edgeCount: number;
  readonly score: number | null;
  readonly grade: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ListScansOptions {
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListScansResult {
  readonly scans: readonly ScanSummary[];
  readonly nextCursor?: string;
}

export interface SaveScanParams extends ScanRecord {
  readonly regions?: readonly string[];
  readonly analysis?: SerializedGraphAnalysis;
  readonly validationReport?: ValidationReport;
  readonly status?: ScanStatus;
  readonly score?: number;
  readonly grade?: string;
  readonly errorMessage?: string;
}

export interface CompleteScanParams {
  readonly scanId: string;
  readonly provider: string;
  readonly regions: readonly string[];
  readonly timestamp: Date;
  readonly nodes: readonly InfraNodeAttrs[];
  readonly edges: ReadonlyArray<ScanEdge>;
  readonly analysis: SerializedGraphAnalysis;
  readonly validationReport: ValidationReport;
  readonly drPlan: DRPlan;
  readonly drPlanValidation: DRPlanValidationReport;
}

export interface SaveReportParams {
  readonly scanId: string;
  readonly type: string;
  readonly format: string;
  readonly content: unknown;
  readonly score?: number;
  readonly grade?: string;
}

export interface SaveDrPlanParams {
  readonly scanId: string;
  readonly format: 'yaml' | 'json';
  readonly content: string;
  readonly plan: DRPlan;
  readonly isValid: boolean;
}

export interface StoredDrPlan {
  readonly id: string;
  readonly scanId: string;
  readonly version: string;
  readonly infrastructureHash: string;
  readonly format: string;
  readonly content: string;
  readonly componentCount: number;
  readonly isValid: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StoredReport {
  readonly id: string;
  readonly scanId: string;
  readonly type: string;
  readonly format: string;
  readonly content: unknown;
  readonly score: number | null;
  readonly grade: string | null;
  readonly createdAt: Date;
}

export interface StoredDriftEvent {
  readonly id: string;
  readonly scanId: string;
  readonly baselineScanId: string | null;
  readonly changeCount: number;
  readonly criticalCount: number;
  readonly drpStale: boolean;
  readonly changes: DriftReport['changes'];
  readonly createdAt: Date;
}

export class PrismaScanRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly encryptionService: ScanDataEncryptionService | null = null,
  ) {}

  public async createPendingScan(params: {
    readonly provider: string;
    readonly regions: readonly string[];
  }): Promise<string> {
    const scan = await this.prisma.scan.create({
      data: {
        provider: params.provider,
        regions: [...params.regions],
        status: 'PENDING',
      },
    });

    return scan.id;
  }

  public async markScanRunning(scanId: string): Promise<void> {
    await this.prisma.scan.update({
      where: { id: scanId },
      data: { status: 'RUNNING', errorMessage: null },
    });
  }

  public async markRunningScansFailed(errorMessage: string): Promise<number> {
    const result = await this.prisma.scan.updateMany({
      where: { status: 'RUNNING' },
      data: {
        status: 'FAILED',
        errorMessage,
      },
    });

    return result.count;
  }

  public async failScan(scanId: string, errorMessage: string): Promise<void> {
    await this.prisma.scan.update({
      where: { id: scanId },
      data: {
        status: 'FAILED',
        errorMessage,
      },
    });
  }

  public async saveScan(params: SaveScanParams): Promise<void> {
    const analysis = params.analysis ?? buildEmptyAnalysis(params.timestamp, params.nodes, params.edges);
    const validationReport =
      params.validationReport ?? buildEmptyValidationReport(params.nodes.length);
    const regions = params.regions ?? [params.region];
    const encoded = serializeStoredScanData(
      {
        nodes: params.nodes,
        edges: params.edges,
        analysis,
        validationReport,
      },
      this.encryptionService,
    );

    await this.prisma.$transaction(async (transaction) => {
      await transaction.scan.upsert({
        where: { id: params.scanId },
        create: {
          id: params.scanId,
          provider: params.provider,
          regions: [...regions],
          status: params.status ?? 'COMPLETED',
          resourceCount: params.nodes.length,
          edgeCount: params.edges.length,
          score: params.score ?? validationReport.scoreBreakdown.overall,
          grade: params.grade ?? validationReport.scoreBreakdown.grade,
          errorMessage: params.errorMessage ?? null,
          createdAt: params.timestamp,
        },
        update: {
          provider: params.provider,
          regions: [...regions],
          status: params.status ?? 'COMPLETED',
          resourceCount: params.nodes.length,
          edgeCount: params.edges.length,
          score: params.score ?? validationReport.scoreBreakdown.overall,
          grade: params.grade ?? validationReport.scoreBreakdown.grade,
          errorMessage: params.errorMessage ?? null,
        },
      });

      await transaction.scanData.upsert({
        where: { scanId: params.scanId },
        create: {
          scanId: params.scanId,
          nodes: toPrismaJson(encoded.nodes),
          edges: toPrismaJson(encoded.edges),
          analysis: toPrismaJson(encoded.analysis),
          validationReport: toPrismaJson(encoded.validationReport),
        },
        update: {
          nodes: toPrismaJson(encoded.nodes),
          edges: toPrismaJson(encoded.edges),
          analysis: toPrismaJson(encoded.analysis),
          validationReport: toPrismaJson(encoded.validationReport),
        },
      });
    });
  }

  public async saveCompletedScan(params: CompleteScanParams): Promise<void> {
    const encoded = serializeStoredScanData(
      {
        nodes: params.nodes,
        edges: params.edges,
        analysis: params.analysis,
        validationReport: params.validationReport,
      },
      this.encryptionService,
    );

    await this.prisma.$transaction(async (transaction) => {
      await transaction.scan.update({
        where: { id: params.scanId },
        data: {
          provider: params.provider,
          regions: [...params.regions],
          status: 'COMPLETED',
          resourceCount: params.nodes.length,
          edgeCount: params.edges.length,
          score: params.validationReport.scoreBreakdown.overall,
          grade: params.validationReport.scoreBreakdown.grade,
          errorMessage: null,
        },
      });

      await transaction.scanData.upsert({
        where: { scanId: params.scanId },
        create: {
          scanId: params.scanId,
          nodes: toPrismaJson(encoded.nodes),
          edges: toPrismaJson(encoded.edges),
          analysis: toPrismaJson(encoded.analysis),
          validationReport: toPrismaJson(encoded.validationReport),
        },
        update: {
          nodes: toPrismaJson(encoded.nodes),
          edges: toPrismaJson(encoded.edges),
          analysis: toPrismaJson(encoded.analysis),
          validationReport: toPrismaJson(encoded.validationReport),
        },
      });

      await transaction.report.create({
        data: {
          scanId: params.scanId,
          type: 'validation',
          format: 'json',
          content: toPrismaJson(params.validationReport),
          score: params.validationReport.scoreBreakdown.overall,
          grade: params.validationReport.scoreBreakdown.grade,
        },
      });

      const plan = await transaction.dRPlan.create({
        data: {
          scanId: params.scanId,
          version: params.drPlan.version,
          infrastructureHash: params.drPlan.infrastructureHash,
          format: 'yaml',
          content: serializeDRPlan(params.drPlan, 'yaml'),
          componentCount: countPlanComponents(params.drPlan),
          isValid: params.drPlanValidation.isValid,
        },
      });

      await transaction.planValidation.create({
        data: {
          planId: plan.id,
          isValid: params.drPlanValidation.isValid,
          issueCount: params.drPlanValidation.issues.length,
          issues: toPrismaJson(params.drPlanValidation.issues),
        },
      });
    });
  }

  public async getScan(scanId: string): Promise<ScanRecord | null> {
    const scan = await this.prisma.scan.findUnique({
      where: { id: scanId },
      include: { scanData: true },
    });

    if (!scan || !scan.scanData) {
      return null;
    }

    const decoded = deserializeStoredScanData(
      {
        nodes: scan.scanData.nodes,
        edges: scan.scanData.edges,
        analysis: scan.scanData.analysis,
        validationReport: scan.scanData.validationReport,
      },
      this.encryptionService,
    );

    return {
      scanId: scan.id,
      provider: scan.provider,
      region: scan.regions[0] ?? 'global',
      timestamp: scan.createdAt,
      nodes: decoded.nodes as unknown as readonly InfraNodeAttrs[],
      edges: decoded.edges as unknown as readonly ScanEdge[],
      metadata: {
        regions: scan.regions,
        status: scan.status,
        resourceCount: scan.resourceCount,
        edgeCount: scan.edgeCount,
        score: scan.score,
        grade: scan.grade,
        errorMessage: scan.errorMessage,
      },
    };
  }

  public async getScanSummary(scanId: string): Promise<ScanSummary | null> {
    const scan = await this.prisma.scan.findUnique({
      where: { id: scanId },
    });

    return scan ? toSummary(scan) : null;
  }

  public async getLatestCompletedScanSummary(): Promise<ScanSummary | null> {
    const scan = await this.prisma.scan.findFirst({
      where: { status: 'COMPLETED' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return scan ? toSummary(scan) : null;
  }

  public async getLatestScan(provider: string): Promise<ScanRecord | null> {
    const scan = await this.prisma.scan.findFirst({
      where: {
        provider,
        status: 'COMPLETED',
      },
      include: { scanData: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    if (!scan || !scan.scanData) {
      return null;
    }

    const decoded = deserializeStoredScanData(
      {
        nodes: scan.scanData.nodes,
        edges: scan.scanData.edges,
        analysis: scan.scanData.analysis,
        validationReport: scan.scanData.validationReport,
      },
      this.encryptionService,
    );

    return {
      scanId: scan.id,
      provider: scan.provider,
      region: scan.regions[0] ?? 'global',
      timestamp: scan.createdAt,
      nodes: decoded.nodes as unknown as readonly InfraNodeAttrs[],
      edges: decoded.edges as unknown as readonly ScanEdge[],
      metadata: {
        regions: scan.regions,
      },
    };
  }

  public async listScans(options: ListScansOptions): Promise<ListScansResult> {
    const records = await this.prisma.scan.findMany({
      take: options.limit + 1,
      ...(options.cursor
        ? {
            cursor: { id: options.cursor },
            skip: 1,
          }
        : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const hasNextPage = records.length > options.limit;
    const scans = records.slice(0, options.limit).map(toSummary);
    const nextCursor = hasNextPage ? scans.at(-1)?.id : undefined;

    return {
      scans,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  public async deleteScan(scanId: string): Promise<boolean> {
    const result = await this.prisma.scan.deleteMany({
      where: { id: scanId },
    });

    return result.count > 0;
  }

  public async saveReport(params: SaveReportParams): Promise<string> {
    const report = await this.prisma.report.create({
      data: {
        scanId: params.scanId,
        type: params.type,
        format: params.format,
        content: toPrismaJson(params.content),
        score: params.score ?? null,
        grade: params.grade ?? null,
      },
    });

    return report.id;
  }

  public async getLatestReport(scanId: string): Promise<StoredReport | null> {
    const report = await this.prisma.report.findFirst({
      where: { scanId },
      orderBy: { createdAt: 'desc' },
    });

    if (!report) {
      return null;
    }

    return {
      id: report.id,
      scanId: report.scanId,
      type: report.type,
      format: report.format,
      content: report.content,
      score: report.score,
      grade: report.grade,
      createdAt: report.createdAt,
    };
  }

  public async getLatestReportByType(
    scanId: string,
    type: string,
  ): Promise<StoredReport | null> {
    const report = await this.prisma.report.findFirst({
      where: { scanId, type },
      orderBy: { createdAt: 'desc' },
    });

    if (!report) {
      return null;
    }

    return {
      id: report.id,
      scanId: report.scanId,
      type: report.type,
      format: report.format,
      content: report.content,
      score: report.score,
      grade: report.grade,
      createdAt: report.createdAt,
    };
  }

  public async saveDRPlan(params: SaveDrPlanParams): Promise<string> {
    const plan = await this.prisma.dRPlan.create({
      data: {
        scanId: params.scanId,
        version: params.plan.version,
        infrastructureHash: params.plan.infrastructureHash,
        format: params.format,
        content: params.content,
        componentCount: countPlanComponents(params.plan),
        isValid: params.isValid,
      },
    });

    return plan.id;
  }

  public async getLatestDRPlan(scanId: string): Promise<StoredDrPlan | null> {
    const plan = await this.prisma.dRPlan.findFirst({
      where: { scanId },
      orderBy: { createdAt: 'desc' },
    });

    if (!plan) {
      return null;
    }

    return {
      id: plan.id,
      scanId: plan.scanId,
      version: plan.version,
      infrastructureHash: plan.infrastructureHash,
      format: plan.format,
      content: plan.content,
      componentCount: plan.componentCount,
      isValid: plan.isValid,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }

  public async savePlanValidation(
    planId: string,
    validation: DRPlanValidationReport,
  ): Promise<string> {
    const record = await this.prisma.planValidation.create({
      data: {
        planId,
        isValid: validation.isValid,
        issueCount: validation.issues.length,
        issues: toPrismaJson(validation.issues),
      },
    });

    return record.id;
  }

  public async saveDriftEvent(scanId: string, report: DriftReport): Promise<string> {
    const record = await this.prisma.driftEvent.create({
      data: {
        scanId,
        baselineScanId: report.scanIdBefore,
        changeCount: report.changes.length,
        criticalCount: report.changes.filter((change) => change.severity === 'critical').length,
        drpStale: report.summary.drpStale,
        changes: toPrismaJson(report.changes),
      },
    });

    return record.id;
  }

  public async listDriftEvents(scanId: string): Promise<readonly StoredDriftEvent[]> {
    const records = await this.prisma.driftEvent.findMany({
      where: { scanId },
      orderBy: { createdAt: 'desc' },
    });

    return records.map((record) => ({
      id: record.id,
      scanId: record.scanId,
      baselineScanId: record.baselineScanId,
      changeCount: record.changeCount,
      criticalCount: record.criticalCount,
      drpStale: record.drpStale,
      changes: record.changes as unknown as DriftReport['changes'],
      createdAt: record.createdAt,
    }));
  }
}

function toSummary(record: {
  readonly id: string;
  readonly provider: string;
  readonly regions: readonly string[];
  readonly status: ScanStatus;
  readonly resourceCount: number;
  readonly edgeCount: number;
  readonly score: number | null;
  readonly grade: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): ScanSummary {
  return {
    id: record.id,
    provider: record.provider,
    regions: [...record.regions],
    status: record.status,
    resourceCount: record.resourceCount,
    edgeCount: record.edgeCount,
    score: record.score,
    grade: record.grade,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function buildEmptyAnalysis(
  timestamp: Date,
  nodes: readonly InfraNodeAttrs[],
  edges: ReadonlyArray<ScanEdge>,
): SerializedGraphAnalysis {
  return {
    timestamp: timestamp.toISOString(),
    totalNodes: nodes.length,
    totalEdges: edges.length,
    spofs: [],
    criticalityScores: {},
    redundancyIssues: [],
    regionalRisks: [],
    circularDeps: [],
    cascadeChains: [],
    resilienceScore: 0,
  };
}

function buildEmptyValidationReport(scannedResources: number): ValidationReport {
  return {
    timestamp: new Date(0).toISOString(),
    totalChecks: 0,
    passed: 0,
    failed: 0,
    warnings: 0,
    skipped: 0,
    errors: 0,
    results: [],
    score: 0,
    scoreBreakdown: {
      overall: 0,
      byCategory: {
        backup: 0,
        redundancy: 0,
        failover: 0,
        detection: 0,
        recovery: 0,
        replication: 0,
      },
      grade: 'F',
      weakestCategory: 'backup',
      scoringMethod: 'n/a',
      disclaimer: 'n/a',
    },
    criticalFailures: [],
    scannedResources,
  };
}

function countPlanComponents(plan: DRPlan): number {
  return plan.services.reduce((count, service) => count + service.components.length, 0);
}
