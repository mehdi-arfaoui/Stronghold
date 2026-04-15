import { randomUUID } from 'node:crypto';

import * as core from '@stronghold-dr/core';
import {
  analyzeBuiltInScenarios,
  analyzeTrend,
  applyPoliciesToServicePosture,
  applyRiskAcceptancesToServicePosture,
  applyScenarioImpactToServicePosture,
  applyEvidenceFreshness,
  applyDebtToSnapshot,
  buildReasoningChain,
  buildScanSnapshot,
  calculateFullChainCoverage,
  calculateRealityGap,
  calculateProofOfRecovery,
  checkFreshness,
  collectGovernanceAuditEvents,
  collectTrackedFindings,
  condenseReasoningChain,
  EVIDENCE_CONFIDENCE,
  calculateServiceDebt,
  deserializeDRPlan,
  dynamoDbPitrEnricher,
  ec2AsgEnricher,
  elasticacheFailoverEnricher,
  formatValidationReport,
  generateDRPlan,
  logGovernanceAuditEvents,
  materializeRiskAcceptances,
  mergeEvidenceIntoValidationReport,
  runValidation,
  s3ReplicationEnricher,
  scanAwsRegion,
  serializeDRPlan,
  trackFindings,
  transformToScanResult,
  validateDRPlan,
  type ApiAddEvidenceInput,
  type ApiEvidenceListResponse,
  type ApiGovernanceAcceptancesResponse,
  type ApiGovernancePoliciesResponse,
  type ApiGovernancePolicySummary,
  type ApiGovernanceResponse,
  type ApiHistoryResponse,
  type ApiHistoryTrendResponse,
  type ApiScenarioDetailResponse,
  type ApiScenariosResponse,
  type ApiServiceHistoryResponse,
  type ApiServiceReasoningResponse,
  type ApiServicesResponse,
  type ApiValidationReportResponse,
  type DRCategory,
  type DRPlan,
  type DRPlanValidationReport,
  type DiscoveryCredentials,
  type Evidence,
  type FindingLifecycle,
  type GovernanceState,
  type InfraNode,
  type ScanSnapshot,
  type ScenarioAnalysis,
  type ServicePosture,
  type ServiceDebt,
  type ValidationReport,
  type ValidationSeverity,
  type FullChainResult,
  type RealityGapResult,
  type ReasoningScanResult,
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
import { InMemoryFindingLifecycleStore } from './history-memory-store.js';
import { PrismaAuditLogger } from './prisma-audit-logger.js';
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

const EVIDENCE_REPORT_TYPE = 'evidence';
const SCENARIO_REPORT_TYPE = 'scenarios';
const GOVERNANCE_REPORT_TYPE = 'governance';
const HISTORY_SNAPSHOT_REPORT_TYPE = 'history_snapshot';
const FINDING_LIFECYCLES_REPORT_TYPE = 'finding_lifecycles';
const DEFAULT_TESTED_EVIDENCE_EXPIRATION_DAYS = 90;

export class ScanService {
  public constructor(
    private readonly scanRepository: PrismaScanRepository,
    private readonly infrastructureRepository: PrismaInfrastructureRepository,
    private readonly logger: Logger,
    private readonly serviceDetectionService: ServiceDetectionService,
    private readonly auditLogger: PrismaAuditLogger,
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
    const scan = await this.requireCompletedScan(scanId);
    const data = await this.infrastructureRepository.getScanData(scanId);
    if (!data) {
      throw new ServerError('Scan data not found', { code: 'SCAN_NOT_FOUND', status: 404 });
    }
    const [servicePosture, scenarioAnalysis, governance, drpPlan] = await Promise.all([
      this.serviceDetectionService.getPersistedServicePosture(scanId),
      this.getPersistedScenarioAnalysis(scanId),
      this.getPersistedGovernance(scanId),
      this.getPersistedDrPlan(scanId),
    ]);
    const storedEvidence = await this.getStoredEvidence(scanId, this.buildServiceLookup(servicePosture));
    const validationReport =
      storedEvidence.length > 0
        ? mergeEvidenceIntoValidationReport(data.validationReport, storedEvidence)
        : data.validationReport;
    const proofOfRecovery = calculateProofOfRecovery({
      validationReport,
      servicePosture,
    });
    const realityGap = calculateRealityGap({
      nodes: data.nodes,
      validationReport,
      servicePosture,
      scenarioAnalysis,
      drpPlan,
    });
    const fullChainCoverage =
      servicePosture
        ? calculateFullChainCoverage({
            nodes: data.nodes,
            edges: data.edges,
            validationReport,
            servicePosture,
            drpPlan,
            evidenceRecords: storedEvidence,
          })
        : null;

    return {
      timestamp: scan.updatedAt.toISOString(),
      provider: scan.provider,
      ...data,
      validationReport,
      proofOfRecovery,
      realityGap,
      ...(fullChainCoverage ? { fullChainCoverage } : {}),
      ...(drpPlan ? { drpPlan } : {}),
      ...(servicePosture ? { servicePosture } : {}),
      ...(governance ? { governance } : {}),
      ...(scenarioAnalysis ? { scenarioAnalysis } : {}),
    };
  }

  public async deleteScan(scanId: string): Promise<boolean> {
    return this.scanRepository.deleteScan(scanId);
  }

  public async getLatestServices() {
    const services = await this.serviceDetectionService.getLatestServices();
    return this.enrichServicesResponseWithReasoning(
      await this.enrichServicesResponseWithEvidence(services),
    );
  }

  public async getServiceDetail(serviceId: string) {
    const detail = await this.serviceDetectionService.getServiceDetail(serviceId);
    const services = await this.enrichServicesResponseWithEvidence({
      scanId: detail.scanId,
      generatedAt: detail.generatedAt,
      services: [detail.service],
      unassigned: {
        score: null,
        resourceCount: detail.unassignedResourceCount,
        contextualFindings: [],
        recommendations: [],
      },
    });
    const enriched = await this.enrichServicesResponseWithReasoning(services);
    return {
      ...detail,
      service: enriched.services[0] ?? detail.service,
    };
  }

  public async redetectLatestServices() {
    const services = await this.serviceDetectionService.redetectLatestServices();
    return this.enrichServicesResponseWithReasoning(
      await this.enrichServicesResponseWithEvidence(services),
    );
  }

  public async getServiceReasoning(serviceId: string): Promise<ApiServiceReasoningResponse> {
    const latestScan = await this.getLatestCompletedScanRequired();
    const currentScan = await this.getScanData(latestScan.id);
    if (!currentScan.servicePosture) {
      throw new ServerError('Service posture not found for latest scan', {
        code: 'SCAN_NOT_FOUND',
        status: 404,
      });
    }

    const normalizedQuery = serviceId.trim().toLowerCase();
    const service =
      currentScan.servicePosture.services.find((entry) => entry.service.id.toLowerCase() === normalizedQuery) ??
      currentScan.servicePosture.services.find(
        (entry) => entry.service.name.toLowerCase() === normalizedQuery,
      );
    if (!service) {
      throw new ServerError('Service not found', {
        code: 'SCAN_NOT_FOUND',
        status: 404,
      });
    }

    const previousScan = await this.loadPreviousReasoningScan(latestScan.id);
    const chain = buildReasoningChain(
      service.service.id,
      this.toReasoningScanResult(currentScan),
      previousScan,
      await this.getLatestFindingLifecycles(),
      currentScan.realityGap ?? this.resolveRealityGap(currentScan),
    );

    return {
      scanId: latestScan.id,
      generatedAt: latestScan.updatedAt.toISOString(),
      chain,
    };
  }

  public async listHistory(options: { readonly limit: number }): Promise<ApiHistoryResponse> {
    const snapshots = await this.listHistorySnapshots(options.limit);
    return {
      snapshots,
      total: snapshots.length,
    };
  }

  public async getHistoryTrend(options: {
    readonly limit: number;
  }): Promise<ApiHistoryTrendResponse> {
    const snapshots = await this.listHistorySnapshots(options.limit);
    const lifecycles = await this.getLatestFindingLifecycles();
    const currentDebt = await this.calculateLatestCurrentDebt(snapshots, lifecycles);

    return {
      snapshots,
      trend: analyzeTrend(snapshots, lifecycles, currentDebt),
    };
  }

  public async getServiceHistory(
    serviceQuery: string,
    options: {
      readonly limit: number;
    },
  ): Promise<ApiServiceHistoryResponse> {
    const snapshots = await this.listHistorySnapshots(options.limit);
    const latestSnapshot = snapshots.at(-1);
    const normalizedQuery = serviceQuery.trim().toLowerCase();
    const service =
      latestSnapshot?.services.find((entry) => entry.serviceId.toLowerCase() === normalizedQuery) ??
      latestSnapshot?.services.find((entry) => entry.serviceName.toLowerCase() === normalizedQuery) ??
      snapshots
        .flatMap((snapshot) => snapshot.services)
        .find(
          (entry) =>
            entry.serviceId.toLowerCase() === normalizedQuery ||
            entry.serviceName.toLowerCase() === normalizedQuery,
        );

    if (!service) {
      throw new ServerError('Service history not found', {
        code: 'SCAN_NOT_FOUND',
        status: 404,
      });
    }

    const lifecycles = (await this.getLatestFindingLifecycles()).filter(
      (entry) => entry.serviceId === service.serviceId,
    );
    const trend = await this.getHistoryTrend({ limit: options.limit });
    return {
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      snapshots: snapshots
        .flatMap((snapshot) => {
          const match = snapshot.services.find((entry) => entry.serviceId === service.serviceId);
          return match
            ? [
                {
                  timestamp: snapshot.timestamp,
                  score: match.score,
                  grade: match.grade,
                  findingCount: match.findingCount,
                  criticalFindingCount: match.criticalFindingCount,
                  resourceCount: match.resourceCount,
                  ...(typeof match.debt === 'number' ? { debt: match.debt } : {}),
                },
              ]
            : [];
        }),
      lifecycles,
      trend:
        trend.trend.services.find((entry) => entry.serviceId === service.serviceId) ?? null,
    };
  }

  public async listScenarios(): Promise<ApiScenariosResponse> {
    const latestScan = await this.getLatestCompletedScanRequired();
    const analysis = await this.getPersistedScenarioAnalysis(latestScan.id);

    return {
      scanId: latestScan.id,
      generatedAt: latestScan.updatedAt.toISOString(),
      scenarios: analysis?.scenarios ?? [],
      defaultScenarioIds: analysis?.defaultScenarioIds ?? [],
      summary: analysis?.summary ?? {
        total: 0,
        covered: 0,
        partiallyCovered: 0,
        uncovered: 0,
        degraded: 0,
      },
    };
  }

  public async getScenarioDetail(id: string): Promise<ApiScenarioDetailResponse> {
    const scenarios = await this.listScenarios();
    const scenario = scenarios.scenarios.find((entry) => entry.id === id);
    if (!scenario) {
      throw new ServerError('Scenario not found', {
        code: 'SCENARIO_NOT_FOUND',
        status: 404,
      });
    }

    return {
      scanId: scenarios.scanId,
      generatedAt: scenarios.generatedAt,
      scenario,
      summary: scenarios.summary,
    };
  }

  public async listEvidence(filters: {
    readonly nodeId?: string;
    readonly serviceId?: string;
  } = {}): Promise<ApiEvidenceListResponse> {
    const latestScan = await this.getLatestCompletedScanRequired();
    const combinedEvidence = await this.getCombinedEvidence(latestScan.id);
    const filtered = combinedEvidence.filter((entry) => {
      if (filters.nodeId && entry.subject.nodeId !== filters.nodeId) {
        return false;
      }
      if (filters.serviceId && entry.subject.serviceId !== filters.serviceId) {
        return false;
      }
      return true;
    });

    return {
      scanId: latestScan.id,
      generatedAt: latestScan.updatedAt.toISOString(),
      evidence: filtered,
    };
  }

  public async getExpiringEvidence(): Promise<ApiEvidenceListResponse> {
    const latestScan = await this.getLatestCompletedScanRequired();
    const combinedEvidence = await this.getCombinedEvidence(latestScan.id);
    const expiring = combinedEvidence.filter((entry) => {
      const freshness = checkFreshness(entry, new Date());
      return freshness.status === 'expiring_soon' || freshness.status === 'expired';
    });

    return {
      scanId: latestScan.id,
      generatedAt: latestScan.updatedAt.toISOString(),
      evidence: expiring,
    };
  }

  public async addEvidence(input: ApiAddEvidenceInput): Promise<Evidence> {
    const latestScan = await this.getLatestCompletedScanRequired();
    const serviceId =
      input.serviceId ?? (await this.resolveServiceIdForNode(latestScan.id, input.nodeId)) ?? undefined;
    const timestamp = new Date();
    const expiresAt = new Date(timestamp);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + (input.expiresDays ?? DEFAULT_TESTED_EVIDENCE_EXPIRATION_DAYS));
    const evidence: Evidence = {
      id: randomUUID(),
      type: 'tested',
      source: {
        origin: 'test',
        testType: input.type,
        testDate: timestamp.toISOString(),
      },
      subject: {
        nodeId: input.nodeId,
        ...(serviceId ? { serviceId } : {}),
      },
      observation: {
        key: input.type,
        value: input.result,
        expected: 'success',
        description: `Manual ${input.type} evidence recorded for ${input.nodeId}.`,
      },
      timestamp: timestamp.toISOString(),
      expiresAt: expiresAt.toISOString(),
      testResult: {
        status: input.result,
        ...(input.duration ? { duration: input.duration } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        executor: input.author ?? 'unknown',
      },
    };

    await this.scanRepository.saveReport({
      scanId: latestScan.id,
      type: EVIDENCE_REPORT_TYPE,
      format: 'json',
      content: evidence,
    });

    return evidence;
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

    const baseReport = runValidation(data.nodes, data.edges, rules);
    const storedEvidence = await this.getStoredEvidence(scanId, this.buildServiceLookup(data.servicePosture ?? null));
    return storedEvidence.length > 0
      ? mergeEvidenceIntoValidationReport(baseReport, storedEvidence)
      : baseReport;
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
  ): Promise<string | ApiValidationReportResponse> {
    const report = await this.getValidationReport(scanId, filters);
    if (format === 'markdown') {
      return formatValidationReport(report);
    }

    const scanData = await this.getScanData(scanId);
    return {
      ...report,
      proofOfRecovery: calculateProofOfRecovery({
        validationReport: scanData.validationReport,
        servicePosture: scanData.servicePosture ?? null,
      }),
      realityGap: scanData.realityGap ?? this.resolveRealityGap(scanData),
    };
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

  public async getPersistedScenarioAnalysis(scanId: string): Promise<ScenarioAnalysis | null> {
    const report = await this.scanRepository.getLatestReportByType(scanId, SCENARIO_REPORT_TYPE);
    return report ? (report.content as ScenarioAnalysis) : null;
  }

  public async getPersistedGovernance(scanId: string): Promise<GovernanceState | null> {
    const report = await this.scanRepository.getLatestReportByType(scanId, GOVERNANCE_REPORT_TYPE);
    return report ? (report.content as GovernanceState) : null;
  }

  public async getPersistedDrPlan(scanId: string): Promise<DRPlan | null> {
    const plan = await this.scanRepository.getLatestDRPlan(scanId);
    if (!plan) {
      return null;
    }

    const parsed = deserializeDRPlan(plan.content);
    if (!parsed.ok) {
      return null;
    }

    return parsed.value;
  }

  public async getLatestGovernance(): Promise<ApiGovernanceResponse> {
    const latestScan = await this.scanRepository.getLatestCompletedScanSummary();
    if (!latestScan) {
      return buildGovernanceResponse(new Date().toISOString(), null, null);
    }

    const [servicePosture, governance] = await Promise.all([
      this.serviceDetectionService.getPersistedServicePosture(latestScan.id),
      this.getPersistedGovernance(latestScan.id),
    ]);

    return buildGovernanceResponse(latestScan.updatedAt.toISOString(), servicePosture, governance);
  }

  public async listGovernanceAcceptances(): Promise<ApiGovernanceAcceptancesResponse> {
    const governance = await this.getLatestGovernance();
    return {
      generatedAt: governance.generatedAt,
      acceptances: governance.riskAcceptances,
    };
  }

  public async listGovernancePolicies(): Promise<ApiGovernancePoliciesResponse> {
    const governance = await this.getLatestGovernance();
    return {
      generatedAt: governance.generatedAt,
      policies: governance.policies,
    };
  }

  public async acceptGovernanceRisk(): Promise<never> {
    throw new ServerError('Governance file editing is not available over the API.', {
      code: 'NOT_IMPLEMENTED',
      status: 501,
    });
  }

  private async persistPostureMemory(params: {
    readonly scanId: string;
    readonly timestamp: Date;
    readonly validationReport: ValidationReport;
    readonly servicePosture: ServicePosture;
    readonly governance?: GovernanceState | null;
    readonly scenarioAnalysis: ScenarioAnalysis;
    readonly realityGap: RealityGapResult;
    readonly fullChainCoverage: FullChainResult | null;
    readonly regions: readonly string[];
    readonly totalResources: number;
  }): Promise<void> {
    const previousSnapshot = (await this.listHistorySnapshots(1))[0] ?? null;
    const trackedFindings = collectTrackedFindings(
      params.validationReport,
      params.servicePosture,
    );
    const currentSnapshot = buildScanSnapshot({
      scanId: params.scanId,
      timestamp: params.timestamp.toISOString(),
      validationReport: params.validationReport,
      totalResources: params.totalResources,
      regions: params.regions,
      servicePosture: params.servicePosture,
      ...(params.governance ? { governance: params.governance } : {}),
      scenarioAnalysis: params.scenarioAnalysis,
      realityGap: params.realityGap,
      fullChainCoverage: params.fullChainCoverage,
    });
    const lifecycleStore = new InMemoryFindingLifecycleStore(
      await this.getLatestFindingLifecycles(),
    );
    await trackFindings(
      trackedFindings.map((finding) => finding.findingKey),
      {
        addSnapshot: async () => undefined,
        getSnapshots: async () =>
          previousSnapshot ? [previousSnapshot, currentSnapshot] : [currentSnapshot],
        getLatest: async () => currentSnapshot,
        getPrevious: async () => previousSnapshot,
        count: async () => (previousSnapshot ? 2 : 1),
      },
      {
        lifecycleStore,
        currentTimestamp: params.timestamp.toISOString(),
        findingContextByKey: new Map(
          trackedFindings.map((finding) => [finding.findingKey, finding] as const),
        ),
      },
    );
    const allLifecycles = await lifecycleStore.getAll(params.timestamp.toISOString());
    const activeLifecycles = await lifecycleStore.getActive(params.timestamp.toISOString());
    const currentDebt = calculateServiceDebt({
      servicePosture: params.servicePosture,
      trackedFindings,
      findingLifecycles: activeLifecycles,
      previousDebt: toPreviousDebt(previousSnapshot),
    });
    const enrichedSnapshot = applyDebtToSnapshot(currentSnapshot, currentDebt);

    await this.scanRepository.saveReport({
      scanId: params.scanId,
      type: HISTORY_SNAPSHOT_REPORT_TYPE,
      format: 'json',
      content: enrichedSnapshot,
      score: enrichedSnapshot.globalScore,
      grade: enrichedSnapshot.globalGrade,
    });
    await this.scanRepository.saveReport({
      scanId: params.scanId,
      type: FINDING_LIFECYCLES_REPORT_TYPE,
      format: 'json',
      content: allLifecycles,
    });
  }

  private async listHistorySnapshots(limit = 20): Promise<readonly ScanSnapshot[]> {
    const reports = await this.scanRepository.listGlobalReportsByType(HISTORY_SNAPSHOT_REPORT_TYPE, {
      limit,
    });
    return reports
      .map((report) => report.content as ScanSnapshot)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  private async getLatestFindingLifecycles(): Promise<readonly FindingLifecycle[]> {
    const report = await this.scanRepository.getLatestGlobalReportByType(
      FINDING_LIFECYCLES_REPORT_TYPE,
    );
    if (!report || !Array.isArray(report.content)) {
      return [];
    }

    return report.content.filter(
      (entry): entry is FindingLifecycle => Boolean(entry) && typeof entry === 'object',
    );
  }

  private async calculateLatestCurrentDebt(
    snapshots: readonly ScanSnapshot[],
    lifecycles: readonly FindingLifecycle[],
  ): Promise<readonly ServiceDebt[]> {
    const latestScan = await this.getLatestCompletedScanRequired();
    const [scanData, servicePosture] = await Promise.all([
      this.infrastructureRepository.getScanData(latestScan.id),
      this.serviceDetectionService.getPersistedServicePosture(latestScan.id),
    ]);
    if (!scanData || !servicePosture) {
      return [];
    }

    return calculateServiceDebt({
      servicePosture,
      trackedFindings: collectTrackedFindings(scanData.validationReport, servicePosture),
      findingLifecycles: lifecycles.filter(
        (lifecycle) => lifecycle.status === 'active' || lifecycle.status === 'recurrent',
      ),
      previousDebt: toPreviousDebt(snapshots.length >= 2 ? snapshots[snapshots.length - 2] ?? null : null),
    });
  }

  private async getLatestCompletedScanRequired(): Promise<ScanSummary> {
    const latestScan = await this.scanRepository.getLatestCompletedScanSummary();
    if (!latestScan) {
      throw new ServerError('No completed scan found', {
        code: 'SCAN_NOT_FOUND',
        status: 404,
      });
    }
    return latestScan;
  }

  private async loadPreviousReasoningScan(
    currentScanId: string,
  ): Promise<ReasoningScanResult | null> {
    const previousScan = await this.scanRepository.getPreviousCompletedScanSummary(currentScanId);
    if (!previousScan) {
      return null;
    }

    const previousData = await this.getScanData(previousScan.id);
    if (!previousData.servicePosture) {
      return null;
    }

    return this.toReasoningScanResult(previousData);
  }

  private async enrichServicesResponseWithReasoning(
    response: ApiServicesResponse,
  ): Promise<ApiServicesResponse> {
    const scanData = await this.getScanData(response.scanId);
    if (!scanData.servicePosture) {
      return response;
    }

    const realityGap = scanData.realityGap ?? this.resolveRealityGap(scanData);
    const fullChainCoverage = scanData.fullChainCoverage ?? this.resolveFullChainCoverage(scanData);
    const previousScan = await this.loadPreviousReasoningScan(response.scanId);
    const lifecycles = await this.getLatestFindingLifecycles();

    return {
      ...response,
      services: response.services.map((service) => {
        const chain = buildReasoningChain(
          service.service.id,
          this.toReasoningScanResult(scanData),
          previousScan,
          lifecycles,
          realityGap,
        );

        return {
          ...service,
          realityGap:
            realityGap.perService.find((entry) => entry.serviceId === service.service.id) ?? null,
          recoveryChain:
            fullChainCoverage?.chains.find((entry) => entry.serviceId === service.service.id) ?? null,
          reasoning: {
            bullets: condenseReasoningChain(chain, 4),
            insights: chain.insights.map((insight) => insight.summary),
            conclusion: chain.conclusion,
            nextAction: chain.nextAction,
          },
        };
      }),
    };
  }

  private async getCombinedEvidence(scanId: string): Promise<readonly Evidence[]> {
    const [scanData, servicePosture, storedEvidenceReports] = await Promise.all([
      this.infrastructureRepository.getScanData(scanId),
      this.serviceDetectionService.getPersistedServicePosture(scanId),
      this.scanRepository.listReportsByType(scanId, EVIDENCE_REPORT_TYPE),
    ]);

    if (!scanData) {
      throw new ServerError('Scan data not found', { code: 'SCAN_NOT_FOUND', status: 404 });
    }

    const serviceLookup = this.buildServiceLookup(servicePosture);
    const observedEvidence = this.collectValidationEvidence(scanData.validationReport, serviceLookup);
    const storedEvidence = storedEvidenceReports
      .flatMap((report) => this.toEvidenceArray(report.content))
      .map((entry) => applyEvidenceFreshness(this.withServiceContext(entry, serviceLookup)));

    return Array.from(
      new Map(
        [...observedEvidence, ...storedEvidence].map((entry) => [entry.id, entry] as const),
      ).values(),
    ).sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  }

  private async getStoredEvidence(
    scanId: string,
    serviceLookup: ReadonlyMap<string, string>,
  ): Promise<readonly Evidence[]> {
    const reports = await this.scanRepository.listReportsByType(scanId, EVIDENCE_REPORT_TYPE);
    return reports
      .flatMap((report) => this.toEvidenceArray(report.content))
      .map((entry) => applyEvidenceFreshness(this.withServiceContext(entry, serviceLookup)));
  }

  private async enrichServicesResponseWithEvidence(
    response: ApiServicesResponse,
  ): Promise<ApiServicesResponse> {
    const serviceLookup = new Map(
      response.services.flatMap((service) =>
        service.service.resources.map((resource) => [resource.nodeId, service.service.id] as const),
      ),
    );
    const evidence = await this.getCombinedEvidence(response.scanId);
    return {
      ...response,
      services: response.services.map((service) => ({
        ...service,
        contextualFindings: service.contextualFindings.map((finding) =>
          this.mergeContextualFindingEvidence(finding, evidence, serviceLookup),
        ),
      })),
      unassigned: {
        ...response.unassigned,
        contextualFindings: response.unassigned.contextualFindings.map((finding) =>
          this.mergeContextualFindingEvidence(finding, evidence, serviceLookup),
        ),
      },
    };
  }

  private mergeContextualFindingEvidence<
    TFinding extends {
      readonly nodeId: string;
      readonly ruleId: string;
      readonly evidence?: readonly Evidence[];
      readonly evidenceSummary?: {
        readonly strongestType: Evidence['type'];
        readonly confidence: number;
      };
    },
  >(
    finding: TFinding,
    evidence: readonly Evidence[],
    serviceLookup: ReadonlyMap<string, string>,
  ): TFinding {
    const matchingEvidence = evidence.filter(
      (entry) =>
        entry.subject.nodeId === finding.nodeId &&
        (!entry.subject.ruleId || entry.subject.ruleId === finding.ruleId),
    );
    const mergedEvidence = Array.from(
      new Map(
        [...(finding.evidence ?? []), ...matchingEvidence].map((entry) => [
          entry.id,
          this.withServiceContext(entry, serviceLookup),
        ] as const),
      ).values(),
    );
    if (mergedEvidence.length === 0) {
      return finding;
    }

    const firstEvidence = mergedEvidence[0];
    if (!firstEvidence) {
      return finding;
    }

    const strongest = mergedEvidence.reduce(
      (current, entry) =>
        EVIDENCE_CONFIDENCE[entry.type] > current.confidence
          ? { strongestType: entry.type, confidence: EVIDENCE_CONFIDENCE[entry.type] }
          : current,
      {
        strongestType: firstEvidence.type,
        confidence: EVIDENCE_CONFIDENCE[firstEvidence.type],
      },
    );

    return {
      ...finding,
      evidence: mergedEvidence,
      evidenceSummary: strongest,
    };
  }

  private collectValidationEvidence(
    report: ValidationReport,
    serviceLookup: ReadonlyMap<string, string>,
  ): readonly Evidence[] {
    const evidence = report.results.flatMap((result) =>
      'evidence' in result && Array.isArray(result.evidence) ? result.evidence : [],
    );

    return Array.from(
      new Map(
        evidence
          .map((entry) => applyEvidenceFreshness(this.withServiceContext(entry, serviceLookup)))
          .map((entry) => [entry.id, entry] as const),
      ).values(),
    );
  }

  private buildServiceLookup(posture: ServicePosture | null): ReadonlyMap<string, string> {
    const entries =
      posture?.services.flatMap((service) =>
        service.service.resources.map((resource) => [resource.nodeId, service.service.id] as const),
      ) ?? [];
    return new Map(entries);
  }

  private withServiceContext(
    evidence: Evidence,
    serviceLookup: ReadonlyMap<string, string>,
  ): Evidence {
    const serviceId = evidence.subject.serviceId ?? serviceLookup.get(evidence.subject.nodeId);
    if (!serviceId) {
      return evidence;
    }

    return {
      ...evidence,
      subject: {
        ...evidence.subject,
        serviceId,
      },
    };
  }

  private toEvidenceArray(content: unknown): readonly Evidence[] {
    if (Array.isArray(content)) {
      return content.filter((entry): entry is Evidence => Boolean(entry) && typeof entry === 'object');
    }
    if (content && typeof content === 'object') {
      return [content as Evidence];
    }
    return [];
  }

  private async resolveServiceIdForNode(
    scanId: string,
    nodeId: string,
  ): Promise<string | null> {
    const posture = await this.serviceDetectionService.getPersistedServicePosture(scanId);
    const service = posture?.services.find((entry) =>
      entry.service.resources.some((resource) => resource.nodeId === nodeId),
    );
    return service?.service.id ?? null;
  }

  private async executeScan(scanId: string, params: CreateScanParams): Promise<void> {
    await this.scanRepository.markScanRunning(scanId);

    try {
      const execution = await this.runAwsScan(params);
      const validation = validateDRPlan(execution.artifacts.drPlan, execution.artifacts.graph);
      const previousCompletedScan = await this.scanRepository.getLatestCompletedScanSummary();
      const previousServicePosture = previousCompletedScan
        ? await this.serviceDetectionService.getPersistedServicePosture(previousCompletedScan.id)
        : null;
      const previousGovernance = previousCompletedScan
        ? await this.getPersistedGovernance(previousCompletedScan.id)
        : null;
      const previousAssignments = previousServicePosture?.detection.services;

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
      const servicePostureResult = this.serviceDetectionService.buildServicePosture({
        nodes: execution.artifacts.nodes,
        edges: execution.artifacts.edges,
        validationReport: execution.artifacts.validationReport,
        drPlan: execution.artifacts.drPlan,
        previousAssignments,
      });
      const scenarioAnalysis = analyzeBuiltInScenarios({
        graph: execution.artifacts.graph,
        nodes: execution.artifacts.nodes,
        services: servicePostureResult.posture.detection.services,
        analysis: execution.artifacts.analysis,
        drp: execution.artifacts.drPlan,
        evidence: [],
      });
      const scenarioAwarePosture = applyScenarioImpactToServicePosture(
        servicePostureResult.posture,
        scenarioAnalysis.scenarios,
      );
      const riskAcceptanceOutcome = servicePostureResult.governance
        ? applyRiskAcceptancesToServicePosture(
            scenarioAwarePosture,
            execution.artifacts.validationReport,
            execution.artifacts.nodes,
            materializeRiskAcceptances(servicePostureResult.governance.riskAcceptances),
            execution.timestamp,
          )
        : null;
      const policyOutcome = servicePostureResult.governance
        ? applyPoliciesToServicePosture(
            riskAcceptanceOutcome?.posture ?? scenarioAwarePosture,
            servicePostureResult.governance.policies,
            execution.artifacts.nodes,
          )
        : null;
      const finalPosture =
        policyOutcome?.posture ?? riskAcceptanceOutcome?.posture ?? scenarioAwarePosture;
      const governanceState = servicePostureResult.governance
        ? {
            riskAcceptances: riskAcceptanceOutcome?.governance.riskAcceptances ?? [],
            score:
              riskAcceptanceOutcome?.governance.score ?? {
                withAcceptances: {
                  score: execution.artifacts.validationReport.scoreBreakdown.overall,
                  grade: execution.artifacts.validationReport.scoreBreakdown.grade,
                },
                withoutAcceptances: {
                  score: execution.artifacts.validationReport.scoreBreakdown.overall,
                  grade: execution.artifacts.validationReport.scoreBreakdown.grade,
                },
                excludedFindings: 0,
              },
            policies: servicePostureResult.governance.policies,
            policyViolations: policyOutcome?.violations ?? [],
          }
        : null;
      const realityGap = calculateRealityGap({
        nodes: execution.artifacts.nodes,
        validationReport: execution.artifacts.validationReport,
        servicePosture: finalPosture,
        scenarioAnalysis,
        drpPlan: execution.artifacts.drPlan,
      });
      const fullChainCoverage = calculateFullChainCoverage({
        nodes: execution.artifacts.nodes,
        edges: execution.artifacts.edges,
        validationReport: execution.artifacts.validationReport,
        servicePosture: finalPosture,
        drpPlan: execution.artifacts.drPlan,
        evidenceRecords: null,
      });
      await this.serviceDetectionService.saveServicePosture(
        scanId,
        finalPosture,
        governanceState?.score.withAcceptances.score ??
          execution.artifacts.validationReport.scoreBreakdown.overall,
        governanceState?.score.withAcceptances.grade ??
          execution.artifacts.validationReport.scoreBreakdown.grade,
        servicePostureResult.warnings,
      );
      if (governanceState) {
        await this.scanRepository.saveReport({
          scanId,
          type: GOVERNANCE_REPORT_TYPE,
          format: 'json',
          content: governanceState,
          score: governanceState.score.withAcceptances.score,
          grade: governanceState.score.withAcceptances.grade,
        });
        const governanceEvents = collectGovernanceAuditEvents(
          {
            timestamp: execution.timestamp.toISOString(),
            servicePosture: finalPosture,
            governance: governanceState,
          },
          previousCompletedScan
            ? {
                timestamp: previousCompletedScan.updatedAt.toISOString(),
                servicePosture: previousServicePosture,
                governance: previousGovernance,
              }
            : null,
        );
        await logGovernanceAuditEvents(this.auditLogger, governanceEvents, {
          timestamp: execution.timestamp.toISOString(),
        });
      }
      await this.scanRepository.saveReport({
        scanId,
        type: SCENARIO_REPORT_TYPE,
        format: 'json',
        content: scenarioAnalysis,
      });
      await this.persistPostureMemory({
        scanId,
        timestamp: execution.timestamp,
        validationReport: execution.artifacts.validationReport,
        servicePosture: finalPosture,
        governance: governanceState,
        scenarioAnalysis,
        realityGap,
        fullChainCoverage,
        regions: params.regions,
        totalResources: execution.artifacts.nodes.length,
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

  private resolveRealityGap(scanData: {
    readonly nodes: readonly InfraNode[];
    readonly validationReport: ValidationReport;
    readonly servicePosture?: ServicePosture;
    readonly scenarioAnalysis?: ScenarioAnalysis | null;
    readonly drpPlan?: DRPlan | null;
    readonly realityGap?: RealityGapResult;
  }): RealityGapResult {
    return (
      scanData.realityGap ??
      calculateRealityGap({
        nodes: scanData.nodes,
        validationReport: scanData.validationReport,
        servicePosture: scanData.servicePosture,
        scenarioAnalysis: scanData.scenarioAnalysis,
        drpPlan: scanData.drpPlan,
      })
    );
  }

  private resolveFullChainCoverage(scanData: {
    readonly nodes: readonly InfraNode[];
    readonly edges: ReadonlyArray<core.ScanEdge>;
    readonly validationReport: ValidationReport;
    readonly servicePosture?: ServicePosture;
    readonly drpPlan?: DRPlan | null;
    readonly fullChainCoverage?: FullChainResult | null;
  }): FullChainResult | null {
    if (!scanData.servicePosture) {
      return null;
    }

    return (
      scanData.fullChainCoverage ??
      calculateFullChainCoverage({
        nodes: scanData.nodes,
        edges: scanData.edges,
        validationReport: scanData.validationReport,
        servicePosture: scanData.servicePosture,
        drpPlan: scanData.drpPlan ?? null,
        evidenceRecords: null,
      })
    );
  }

  private toReasoningScanResult(scanData: {
    readonly timestamp?: string;
    readonly nodes: readonly InfraNode[];
    readonly edges: ReadonlyArray<core.ScanEdge>;
    readonly provider: string;
    readonly validationReport: ValidationReport;
    readonly servicePosture?: ServicePosture;
    readonly scenarioAnalysis?: ScenarioAnalysis | null;
    readonly drpPlan?: DRPlan | null;
    readonly governance?: GovernanceState | null;
    readonly fullChainCoverage?: FullChainResult | null;
  }): ReasoningScanResult {
    if (!scanData.servicePosture) {
      throw new Error('Service posture is unavailable for reasoning.');
    }

    return {
      ...scanData,
      timestamp: scanData.timestamp,
      provider: scanData.provider,
      nodes: [...scanData.nodes],
      edges: [...scanData.edges],
      scannedAt: scanData.timestamp ? new Date(scanData.timestamp) : new Date(0),
      validationReport: scanData.validationReport,
      servicePosture: scanData.servicePosture,
      scenarioAnalysis: scanData.scenarioAnalysis,
      drpPlan: scanData.drpPlan,
      governance: scanData.governance,
      fullChainCoverage: scanData.fullChainCoverage ?? null,
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

function toPreviousDebt(snapshot: ScanSnapshot | null): readonly ServiceDebt[] {
  if (!snapshot) {
    return [];
  }

  return snapshot.services
    .filter((service) => typeof service.debt === 'number')
    .map((service) => ({
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      totalDebt: service.debt ?? 0,
      criticalDebt: 0,
      findingDebts: [],
      trend: 'stable' as const,
    }));
}

function buildGovernanceResponse(
  generatedAt: string,
  servicePosture: ServicePosture | null,
  governance: GovernanceState | null,
): ApiGovernanceResponse {
  const violations = governance?.policyViolations ?? [];
  const policies = (governance?.policies ?? []).map((policy) => ({
    policy,
    violationCount: violations.filter((violation) => violation.policyId === policy.id).length,
    violations: violations.filter((violation) => violation.policyId === policy.id),
  })) satisfies readonly ApiGovernancePolicySummary[];

  return {
    generatedAt,
    ownership:
      servicePosture?.services.map((service) => ({
        serviceId: service.service.id,
        serviceName: service.service.name,
        owner: service.service.governance?.owner ?? service.service.owner ?? null,
        ownerStatus: service.service.governance?.ownerStatus ?? (service.service.owner ? 'declared' : 'none'),
        confirmedAt: service.service.governance?.confirmedAt ?? null,
        nextReviewAt: service.service.governance?.nextReviewAt ?? null,
      })) ?? [],
    riskAcceptances: governance?.riskAcceptances ?? [],
    policies,
    violations,
    score: governance?.score ?? null,
  };
}
