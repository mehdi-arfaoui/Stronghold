import * as core from '@stronghold-dr/core';
import {
  deserializeDRPlan,
  dynamoDbPitrEnricher,
  ec2AsgEnricher,
  elasticacheFailoverEnricher,
  formatValidationReport,
  generateDRPlan,
  runValidation,
  s3ReplicationEnricher,
  scanAwsRegion,
  serializeDRPlan,
  transformToScanResult,
  validateDRPlan,
  type DRCategory,
  type DRPlan,
  type DRPlanValidationReport,
  type DiscoveryCredentials,
  type InfraNode,
  type ValidationReport,
  type ValidationSeverity,
} from '@stronghold-dr/core';
import type { Logger } from '@stronghold-dr/core';

import { PrismaInfrastructureRepository } from '../adapters/prisma-infrastructure-repository.js';
import {
  PrismaScanRepository,
  type ListScansResult,
  type ScanSummary,
  type StoredDrPlan,
} from '../adapters/prisma-scan-repository.js';
import { ServerError, toError } from '../errors/server-error.js';
import { deserializeAnalysis } from './analysis-serialization.js';
import { buildGraph } from './graph-builder.js';
import { runScanPipeline } from './scan-pipeline.js';
import { ServiceDetectionService } from './service-detection.service.js';

export interface CreateScanParams {
  readonly provider: 'aws';
  readonly regions: readonly string[];
  readonly services?: readonly string[];
}

export interface ValidationReportFilters {
  readonly category?: DRCategory;
  readonly severity?: ValidationSeverity;
}

export class ScanService {
  public constructor(
    private readonly scanRepository: PrismaScanRepository,
    private readonly infrastructureRepository: PrismaInfrastructureRepository,
    private readonly logger: Logger,
    private readonly serviceDetectionService: ServiceDetectionService,
  ) {}

  public async recoverOrphanedScans(): Promise<number> {
    return this.scanRepository.markRunningScansFailed(
      'Scan interrupted during a previous server restart.',
    );
  }

  public async createScan(params: CreateScanParams): Promise<string> {
    const scanId = await this.scanRepository.createPendingScan(params);
    void this.executeScan(scanId, params).catch((error) => {
      this.logger.error('scan.background.failed', error, { scanId });
    });
    return scanId;
  }

  public async listScans(options: {
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<ListScansResult> {
    return this.scanRepository.listScans(options);
  }

  public async getScanSummary(scanId: string): Promise<ScanSummary> {
    const scan = await this.scanRepository.getScanSummary(scanId);
    if (!scan) {
      throw new ServerError('Scan not found', { code: 'SCAN_NOT_FOUND', status: 404 });
    }
    return scan;
  }

  public async getScanData(scanId: string) {
    await this.requireCompletedScan(scanId);
    const data = await this.infrastructureRepository.getScanData(scanId);
    if (!data) {
      throw new ServerError('Scan data not found', { code: 'SCAN_NOT_FOUND', status: 404 });
    }
    const servicePosture = await this.serviceDetectionService.getPersistedServicePosture(scanId);
    return {
      ...data,
      ...(servicePosture ? { servicePosture } : {}),
    };
  }

  public async deleteScan(scanId: string): Promise<boolean> {
    return this.scanRepository.deleteScan(scanId);
  }

  public async getLatestServices() {
    return this.serviceDetectionService.getLatestServices();
  }

  public async getServiceDetail(serviceId: string) {
    return this.serviceDetectionService.getServiceDetail(serviceId);
  }

  public async redetectLatestServices() {
    return this.serviceDetectionService.redetectLatestServices();
  }

  public async getValidationReport(
    scanId: string,
    filters: ValidationReportFilters = {},
  ): Promise<ValidationReport> {
    const data = await this.getScanData(scanId);
    const availableRules = core.allValidationRules;
    if (!Array.isArray(availableRules)) {
      throw new ServerError('Validation rules are unavailable', {
        code: 'INTERNAL_ERROR',
        status: 500,
      });
    }

    const rules = availableRules.filter((rule) => {
      if (filters.category && rule.category !== filters.category) {
        return false;
      }
      if (filters.severity && rule.severity !== filters.severity) {
        return false;
      }
      return true;
    });

    return runValidation(data.nodes, data.edges, rules);
  }

  public async getValidationSummary(scanId: string): Promise<{
    readonly score: number;
    readonly grade: string;
    readonly categories: ValidationReport['scoreBreakdown']['byCategory'];
    readonly topFailures: readonly {
      readonly ruleId: string;
      readonly nodeId: string;
      readonly nodeName: string;
      readonly severity: string;
      readonly message: string;
    }[];
  }> {
    const report = await this.getValidationReport(scanId);

    return {
      score: report.scoreBreakdown.overall,
      grade: report.scoreBreakdown.grade,
      categories: report.scoreBreakdown.byCategory,
      topFailures: report.criticalFailures.slice(0, 3).map((failure) => ({
        ruleId: failure.ruleId,
        nodeId: failure.nodeId,
        nodeName: failure.nodeName,
        severity: failure.severity,
        message: failure.message,
      })),
    };
  }

  public async renderValidationReport(
    scanId: string,
    format: 'json' | 'markdown',
    filters: ValidationReportFilters = {},
  ): Promise<string | ValidationReport> {
    const report = await this.getValidationReport(scanId, filters);
    return format === 'markdown' ? formatValidationReport(report) : report;
  }

  public async generatePlan(scanId: string, format: 'yaml' | 'json'): Promise<{
    readonly plan: DRPlan;
    readonly format: 'yaml' | 'json';
    readonly content: string;
    readonly validation: DRPlanValidationReport;
  }> {
    const data = await this.getScanData(scanId);
    const scan = await this.getScanSummary(scanId);
    const graph = buildGraph(data.nodes, data.edges);
    const analysis = deserializeAnalysis(data.analysis);
    const plan = generateDRPlan({
      graph,
      analysis,
      provider: scan.provider,
      generatedAt: new Date(),
    });
    const validation = validateDRPlan(plan, graph);
    const content = serializeDRPlan(plan, format);
    const planId = await this.scanRepository.saveDRPlan({
      scanId,
      plan,
      format,
      content,
      isValid: validation.isValid,
    });
    await this.scanRepository.savePlanValidation(planId, validation);

    return {
      plan,
      format,
      content,
      validation,
    };
  }

  public async getLatestPlan(scanId: string): Promise<StoredDrPlan> {
    const plan = await this.scanRepository.getLatestDRPlan(scanId);
    if (!plan) {
      throw new ServerError('Plan not found', { code: 'PLAN_NOT_FOUND', status: 404 });
    }
    return plan;
  }

  public async validatePlan(
    planContent: string,
    scanId: string,
  ): Promise<DRPlanValidationReport> {
    const parsed = deserializeDRPlan(planContent);
    if (!parsed.ok) {
      throw new ServerError('Plan validation failed', {
        code: 'PLAN_INVALID',
        status: 422,
        details: parsed.errors,
      });
    }

    const data = await this.getScanData(scanId);
    const graph = buildGraph(data.nodes, data.edges);
    return validateDRPlan(parsed.value, graph);
  }

  private async executeScan(scanId: string, params: CreateScanParams): Promise<void> {
    await this.scanRepository.markScanRunning(scanId);

    try {
      const execution = await this.runAwsScan(params);
      const validation = validateDRPlan(execution.artifacts.drPlan, execution.artifacts.graph);
      const previousCompletedScan = await this.scanRepository.getLatestCompletedScanSummary();
      const previousAssignments =
        previousCompletedScan
          ? (await this.serviceDetectionService.getPersistedServicePosture(previousCompletedScan.id))
              ?.detection.services
          : undefined;

      await this.scanRepository.saveCompletedScan({
        scanId,
        provider: params.provider,
        regions: params.regions,
        timestamp: execution.timestamp,
        nodes: execution.artifacts.nodes,
        edges: execution.artifacts.edges,
        analysis: execution.artifacts.serializedAnalysis,
        validationReport: execution.artifacts.validationReport,
        drPlan: execution.artifacts.drPlan,
        drPlanValidation: validation,
      });
      await this.serviceDetectionService.persistServicePosture(scanId, {
        nodes: execution.artifacts.nodes,
        edges: execution.artifacts.edges,
        validationReport: execution.artifacts.validationReport,
        drPlan: execution.artifacts.drPlan,
        previousAssignments,
      });

      if (execution.warnings.length > 0) {
        this.logger.warn('scan.completed_with_warnings', {
          scanId,
          warnings: execution.warnings,
        });
      }
    } catch (error) {
      await this.scanRepository.failScan(scanId, toError(error).message).catch(() => undefined);
      throw error;
    }
  }

  private async runAwsScan(params: CreateScanParams): Promise<{
    readonly timestamp: Date;
    readonly warnings: readonly string[];
    readonly artifacts: Awaited<ReturnType<typeof runScanPipeline>>;
  }> {
    const credentials: DiscoveryCredentials = { aws: {} };
    const mergedResources = [];
    const warnings: string[] = [];
    const timestamp = new Date();

    for (const [index, region] of params.regions.entries()) {
      const startedAt = Date.now();
      this.logger.info('scan.region.started', { provider: params.provider, region });
      const result = await scanAwsRegion(
        {
          region,
          credentials: credentials.aws ?? {},
        },
        {
          includeGlobalServices: index === 0,
          services: params.services,
        },
      );
      mergedResources.push(...result.resources);
      warnings.push(...result.warnings);
      this.logger.info('scan.region.completed', {
        provider: params.provider,
        region,
        durationMs: Date.now() - startedAt,
        resourceCount: result.resources.length,
      });
    }

    const transformed = transformToScanResult(mergedResources, [], params.provider);
    const nodes = transformed.nodes as readonly InfraNode[];
    const edges = transformed.edges;

    await enrichNodes(nodes, credentials, params.services, warnings, this.logger);

    return {
      timestamp,
      warnings,
      artifacts: await runScanPipeline({
        provider: params.provider,
        regions: params.regions,
        nodes,
        edges,
        timestamp,
      }),
    };
  }

  private async requireCompletedScan(scanId: string): Promise<ScanSummary> {
    const scan = await this.getScanSummary(scanId);
    if (scan.status !== 'COMPLETED') {
      throw new ServerError('Scan data is only available for completed scans', {
        code: 'SCAN_NOT_FOUND',
        status: 404,
      });
    }
    return scan;
  }
}

async function enrichNodes(
  nodes: readonly InfraNode[],
  credentials: DiscoveryCredentials,
  services: readonly string[] | undefined,
  warnings: string[],
  logger: Logger,
): Promise<void> {
  const mutableNodes = [...nodes];
  const enrichers = [
    {
      service: 's3',
      name: 'S3 metadata',
      run: () => s3ReplicationEnricher.enrich(mutableNodes, credentials.aws ?? {}),
    },
    {
      service: 'dynamodb',
      name: 'DynamoDB PITR metadata',
      run: () => dynamoDbPitrEnricher.enrich(mutableNodes, credentials.aws ?? {}),
    },
    {
      service: 'ec2',
      name: 'EC2 Auto Scaling metadata',
      run: () => ec2AsgEnricher.enrich(mutableNodes, credentials.aws ?? {}),
    },
    {
      service: 'elasticache',
      name: 'ElastiCache failover metadata',
      run: () => elasticacheFailoverEnricher.enrich(mutableNodes, credentials.aws ?? {}),
    },
  ] as const;

  for (const enricher of enrichers) {
    if (services && services.length > 0 && !services.includes(enricher.service)) {
      continue;
    }

    logger.info('scan.enrichment.started', { name: enricher.name });
    const result = await enricher.run();
    if (result.failed > 0) {
      warnings.push(`${enricher.name} enrichment failed for ${result.failed} resource(s).`);
    }
  }
}
