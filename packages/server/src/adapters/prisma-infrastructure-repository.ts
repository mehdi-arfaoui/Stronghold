import { PrismaClient } from '@prisma/client';
import type { InfraNode, ScanEdge, ValidationReport } from '@stronghold-dr/core';

import type { SerializedGraphAnalysis } from '../services/analysis-serialization.js';
import {
  deserializeStoredScanData,
  serializeStoredScanData,
  type ScanDataEncryptionService,
} from '../services/encryption.service.js';
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
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly encryptionService: ScanDataEncryptionService | null = null,
  ) {}

  public async getScanData(scanId: string): Promise<StoredScanData | null> {
    const record = await this.prisma.scanData.findUnique({
      where: { scanId },
    });

    if (!record) {
      return null;
    }

    const decoded = deserializeStoredScanData(
      {
        nodes: record.nodes,
        edges: record.edges,
        analysis: record.analysis,
        validationReport: record.validationReport,
      },
      this.encryptionService,
    );

    return {
      nodes: decoded.nodes as unknown as readonly InfraNode[],
      edges: decoded.edges as unknown as ReadonlyArray<ScanEdge>,
      analysis: decoded.analysis as unknown as SerializedGraphAnalysis,
      validationReport: decoded.validationReport as unknown as ValidationReport,
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
    const encoded = serializeStoredScanData(
      {
        nodes: params.nodes,
        edges: params.edges,
        analysis: params.analysis,
        validationReport: params.validationReport,
      },
      this.encryptionService,
    );

    await this.prisma.scanData.upsert({
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
  }
}
