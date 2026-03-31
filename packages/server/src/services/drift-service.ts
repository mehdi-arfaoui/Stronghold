import {
  analyzeDriftImpact,
  deserializeDRPlan,
  detectDrift,
  type DriftReport,
} from '@stronghold-dr/core';
import type { Logger } from '@stronghold-dr/core';

import { PrismaInfrastructureRepository } from '../adapters/prisma-infrastructure-repository.js';
import { PrismaScanRepository } from '../adapters/prisma-scan-repository.js';
import { ServerError } from '../errors/server-error.js';
import { buildGraph } from './graph-builder.js';

export class DriftService {
  public constructor(
    private readonly scanRepository: PrismaScanRepository,
    private readonly infrastructureRepository: PrismaInfrastructureRepository,
    private readonly logger: Logger,
  ) {}

  public async checkDrift(params: {
    readonly currentScanId: string;
    readonly baselineScanId: string;
  }): Promise<DriftReport> {
    const currentData = await this.infrastructureRepository.getScanData(params.currentScanId);
    const baselineData = await this.infrastructureRepository.getScanData(params.baselineScanId);

    if (!currentData || !baselineData) {
      throw new ServerError('Scan not found', { code: 'SCAN_NOT_FOUND', status: 404 });
    }

    const latestPlan = await this.scanRepository.getLatestDRPlan(params.baselineScanId);
    const report = analyzeDriftImpact(
      detectDrift(baselineData.nodes, currentData.nodes, {
        scanIdBefore: params.baselineScanId,
        scanIdAfter: params.currentScanId,
      }),
      buildGraph(currentData.nodes, currentData.edges),
      {
        drpComponentIds: latestPlan ? getPlanComponentIds(latestPlan.content) : [],
      },
    );

    await this.scanRepository.saveDriftEvent(params.currentScanId, report);
    this.logger.info('drift.completed', {
      currentScanId: params.currentScanId,
      baselineScanId: params.baselineScanId,
      changeCount: report.changes.length,
    });

    return report;
  }

  public async listDriftEvents(scanId: string) {
    return this.scanRepository.listDriftEvents(scanId);
  }
}

function getPlanComponentIds(planContent: string): readonly string[] {
  const parsed = deserializeDRPlan(planContent);
  if (!parsed.ok) {
    return [];
  }

  return parsed.value.services
    .flatMap((service) => service.components.map((component) => component.resourceId))
    .sort((left, right) => left.localeCompare(right));
}
