import {
  buildServicePosture,
  deserializeDRPlan,
  generateRecommendations,
  loadManualServices,
  type ApiServiceDetailResponse,
  type ApiServicesResponse,
  type DRPlan,
  type InfraNode,
  type ScanEdge,
  type ServicePosture,
  type ValidationReport,
} from '@stronghold-dr/core';
import type { Logger } from '@stronghold-dr/core';

import { PrismaInfrastructureRepository } from '../adapters/prisma-infrastructure-repository.js';
import { PrismaScanRepository } from '../adapters/prisma-scan-repository.js';
import { ServerError } from '../errors/server-error.js';

const SERVICE_REPORT_TYPE = 'services';

export interface BuildServicePostureParams {
  readonly nodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<ScanEdge>;
  readonly validationReport: ValidationReport;
  readonly drPlan: DRPlan;
  readonly isDemo?: boolean;
  readonly previousAssignments?: readonly import('@stronghold-dr/core').Service[];
}

export class ServiceDetectionService {
  public constructor(
    private readonly scanRepository: PrismaScanRepository,
    private readonly infrastructureRepository: PrismaInfrastructureRepository,
    private readonly logger: Logger,
    private readonly servicesFilePath: string,
  ) {}

  public buildServicePosture(
    params: BuildServicePostureParams,
  ): { readonly posture: ServicePosture; readonly warnings: readonly string[] } {
    const recommendations = generateRecommendations({
      nodes: params.nodes,
      validationReport: params.validationReport,
      drpPlan: params.drPlan,
      isDemo: params.isDemo,
    });
    const manualServices = loadManualServices(params.nodes, {
      filePath: this.servicesFilePath,
      previousAssignments: params.previousAssignments,
    });
    const warnings = [
      ...(manualServices?.warnings ?? []),
      ...(manualServices?.newMatches.flatMap((match) => [
        `${match.resourceIds.length} new resources matched service "${match.serviceName}" since the previous scan.`,
      ]) ?? []),
    ];
    const posture = buildServicePosture({
      nodes: params.nodes,
      edges: params.edges,
      validationReport: params.validationReport,
      recommendations,
      manualServices: manualServices?.services,
    });

    return {
      posture,
      warnings,
    };
  }

  public async persistServicePosture(
    scanId: string,
    params: BuildServicePostureParams,
  ): Promise<ServicePosture> {
    const { posture, warnings } = this.buildServicePosture(params);
    return this.saveServicePosture(scanId, posture, params.validationReport.scoreBreakdown.overall, params.validationReport.scoreBreakdown.grade, warnings);
  }

  public async saveServicePosture(
    scanId: string,
    posture: ServicePosture,
    score: number,
    grade: string,
    warnings: readonly string[] = [],
  ): Promise<ServicePosture> {
    await this.scanRepository.saveReport({
      scanId,
      type: SERVICE_REPORT_TYPE,
      format: 'json',
      content: posture,
      score,
      grade,
    });

    if (warnings.length > 0) {
      this.logger.warn('services.persisted_with_warnings', {
        scanId,
        warnings,
      });
    }

    return posture;
  }

  public async getPersistedServicePosture(scanId: string): Promise<ServicePosture | null> {
    const report = await this.scanRepository.getLatestReportByType(scanId, SERVICE_REPORT_TYPE);
    return report ? (report.content as ServicePosture) : null;
  }

  public async getLatestServices(): Promise<ApiServicesResponse> {
    const scan = await this.scanRepository.getLatestCompletedScanSummary();
    if (!scan) {
      throw new ServerError('No completed scan found', {
        code: 'SCAN_NOT_FOUND',
        status: 404,
      });
    }

    const posture = await this.getPersistedServicePosture(scan.id);
    if (!posture) {
      throw new ServerError('Service posture not found for latest scan', {
        code: 'SCAN_NOT_FOUND',
        status: 404,
      });
    }

    return {
      scanId: scan.id,
      generatedAt: scan.updatedAt.toISOString(),
      services: posture.services,
      unassigned: posture.unassigned,
    };
  }

  public async getServiceDetail(serviceId: string): Promise<ApiServiceDetailResponse> {
    const services = await this.getLatestServices();
    const service = services.services.find(
      (entry) =>
        entry.service.id === serviceId ||
        entry.service.name.toLowerCase() === serviceId.toLowerCase(),
    );
    if (!service) {
      throw new ServerError('Service not found', {
        code: 'SCAN_NOT_FOUND',
        status: 404,
      });
    }

    return {
      scanId: services.scanId,
      generatedAt: services.generatedAt,
      service,
      unassignedResourceCount: services.unassigned.resourceCount,
    };
  }

  public async redetectLatestServices(): Promise<ApiServicesResponse> {
    const scan = await this.scanRepository.getLatestCompletedScanSummary();
    if (!scan) {
      throw new ServerError('No completed scan found', {
        code: 'SCAN_NOT_FOUND',
        status: 404,
      });
    }

    const scanData = await this.infrastructureRepository.getScanData(scan.id);
    if (!scanData) {
      throw new ServerError('Scan data not found', {
        code: 'SCAN_NOT_FOUND',
        status: 404,
      });
    }

    const latestPlan = await this.scanRepository.getLatestDRPlan(scan.id);
    if (!latestPlan) {
      throw new ServerError('Plan not found', {
        code: 'PLAN_NOT_FOUND',
        status: 404,
      });
    }
    const parsedPlan = deserializeDRPlan(latestPlan.content);
    if (!parsedPlan.ok) {
      throw new ServerError('Stored plan could not be parsed', {
        code: 'PLAN_INVALID',
        status: 500,
        details: parsedPlan.errors,
      });
    }
    const previousAssignments = (await this.getPersistedServicePosture(scan.id))?.detection.services;

    const posture = await this.persistServicePosture(scan.id, {
      nodes: scanData.nodes,
      edges: scanData.edges,
      validationReport: scanData.validationReport,
      drPlan: parsedPlan.value,
      previousAssignments,
    });

    return {
      scanId: scan.id,
      generatedAt: new Date().toISOString(),
      services: posture.services,
      unassigned: posture.unassigned,
    };
  }
}
