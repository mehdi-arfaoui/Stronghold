import { PrismaClient } from '@prisma/client';
import type { InfraNode, ScanEdge, ValidationReport } from '@stronghold-dr/core';

import type { SerializedGraphAnalysis } from '../services/analysis-serialization.js';
import { toPrismaJson } from '../utils/prisma-json.js';

export interface StoredScanData {
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<ScanEdge>;
  readonly analysis: SerializedGraphAnalysis;
  readonly validationReport: ValidationReport;
}

export interface SaveScanDataParams extends StoredScanData {
  readonly scanId: string;
}

export class PrismaInfrastructureRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async getScanData(scanId: string): Promise<StoredScanData | null> {
    const record = await this.prisma.scanData.findUnique({
      where: { scanId },
    });

    if (!record) {
      return null;
    }

    return {
      nodes: record.nodes as unknown as readonly InfraNode[],
      edges: record.edges as unknown as ReadonlyArray<ScanEdge>,
      analysis: record.analysis as unknown as SerializedGraphAnalysis,
      validationReport: record.validationReport as unknown as ValidationReport,
    };
  }

  public async getNodes(scanId: string): Promise<readonly InfraNode[]> {
    const record = await this.getScanData(scanId);
    return record?.nodes ?? [];
  }

  public async getEdges(scanId: string): Promise<ReadonlyArray<ScanEdge>> {
    const record = await this.getScanData(scanId);
    return record?.edges ?? [];
  }

  public async getAnalysis(scanId: string): Promise<SerializedGraphAnalysis | null> {
    const record = await this.getScanData(scanId);
    return record?.analysis ?? null;
  }

  public async getValidationReport(scanId: string): Promise<ValidationReport | null> {
    const record = await this.getScanData(scanId);
    return record?.validationReport ?? null;
  }

  public async saveScanData(params: SaveScanDataParams): Promise<void> {
    await this.prisma.scanData.upsert({
      where: { scanId: params.scanId },
      create: {
        scanId: params.scanId,
        nodes: toPrismaJson(params.nodes),
        edges: toPrismaJson(params.edges),
        analysis: toPrismaJson(params.analysis),
        validationReport: toPrismaJson(params.validationReport),
      },
      update: {
        nodes: toPrismaJson(params.nodes),
        edges: toPrismaJson(params.edges),
        analysis: toPrismaJson(params.analysis),
        validationReport: toPrismaJson(params.validationReport),
      },
    });
  }
}
