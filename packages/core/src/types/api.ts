import type { DRPlan, DRPlanValidationReport } from '../drp/drp-types.js';
import type { GraphAnalysisReport } from './analysis.js';
import type { DriftReport } from '../drift/drift-types.js';
import type { Evidence } from '../evidence/index.js';
import type { ValidationReport, ValidationSeverity } from '../validation/validation-types.js';
import type { InfraNodeAttrs, ScanEdge } from './infrastructure.js';
import type { Scenario, ScenarioCoverageSummary } from '../scenarios/scenario-types.js';
import type {
  ContextualFinding,
  Service,
  ServicePosture,
  ServiceRecommendationProjection,
  ServiceScore,
} from '../services/index.js';

export type ApiScanStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';

export interface SerializedGraphAnalysis {
  readonly timestamp: string;
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly spofs: GraphAnalysisReport['spofs'];
  readonly criticalityScores: Record<string, number>;
  readonly redundancyIssues: GraphAnalysisReport['redundancyIssues'];
  readonly regionalRisks: GraphAnalysisReport['regionalRisks'];
  readonly circularDeps: GraphAnalysisReport['circularDeps'];
  readonly cascadeChains: GraphAnalysisReport['cascadeChains'];
  readonly resilienceScore: number;
}

export interface ApiCreateScanResponse {
  readonly scanId: string;
  readonly status: ApiScanStatus;
}

export interface ApiScanSummary {
  readonly id: string;
  readonly provider: string;
  readonly regions: readonly string[];
  readonly status: ApiScanStatus;
  readonly resourceCount: number;
  readonly edgeCount: number;
  readonly score: number | null;
  readonly grade: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiListScansResult {
  readonly scans: readonly ApiScanSummary[];
  readonly nextCursor?: string;
}

export interface ApiScanData {
  readonly nodes: readonly InfraNodeAttrs[];
  readonly edges: ReadonlyArray<ScanEdge>;
  readonly analysis: SerializedGraphAnalysis;
  readonly validationReport: ValidationReport;
  readonly servicePosture?: ServicePosture;
  readonly scenarioAnalysis?: {
    readonly scenarios: readonly Scenario[];
    readonly defaultScenarioIds: readonly string[];
    readonly summary: ScenarioCoverageSummary;
  };
}

export interface ApiValidationSummary {
  readonly score: number;
  readonly grade: string;
  readonly categories: ValidationReport['scoreBreakdown']['byCategory'];
  readonly topFailures: readonly {
    readonly ruleId: string;
    readonly nodeId: string;
    readonly nodeName: string;
    readonly severity: ValidationSeverity;
    readonly message: string;
  }[];
}

export interface ApiServiceSummary {
  readonly service: Service;
  readonly score: ServiceScore;
  readonly contextualFindings: readonly ContextualFinding[];
  readonly recommendations: readonly ServiceRecommendationProjection[];
}

export interface ApiServicesResponse {
  readonly scanId: string;
  readonly generatedAt: string;
  readonly services: readonly ApiServiceSummary[];
  readonly unassigned: {
    readonly score: ServiceScore | null;
    readonly resourceCount: number;
    readonly contextualFindings: readonly ContextualFinding[];
    readonly recommendations: readonly ServiceRecommendationProjection[];
  };
}

export interface ApiServiceDetailResponse {
  readonly scanId: string;
  readonly generatedAt: string;
  readonly service: ApiServiceSummary;
  readonly unassignedResourceCount: number;
}

export interface ApiScenariosResponse {
  readonly scanId: string;
  readonly generatedAt: string;
  readonly scenarios: readonly Scenario[];
  readonly defaultScenarioIds: readonly string[];
  readonly summary: ScenarioCoverageSummary;
}

export interface ApiScenarioDetailResponse {
  readonly scanId: string;
  readonly generatedAt: string;
  readonly scenario: Scenario;
  readonly summary: ScenarioCoverageSummary;
}

export interface ApiStoredDrPlan {
  readonly id: string;
  readonly scanId: string;
  readonly version: string;
  readonly infrastructureHash: string;
  readonly format: string;
  readonly content: string;
  readonly componentCount: number;
  readonly isValid: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiGeneratePlanResult {
  readonly plan: DRPlan;
  readonly format: 'yaml' | 'json';
  readonly content: string;
  readonly validation: DRPlanValidationReport;
}

export interface ApiDriftEvent {
  readonly id: string;
  readonly scanId: string;
  readonly baselineScanId: string | null;
  readonly changeCount: number;
  readonly criticalCount: number;
  readonly drpStale: boolean;
  readonly changes: DriftReport['changes'];
  readonly createdAt: string;
}

export interface ApiDriftEventsResponse {
  readonly events: readonly ApiDriftEvent[];
}

export interface ApiEvidenceListResponse {
  readonly scanId: string;
  readonly generatedAt: string;
  readonly evidence: readonly Evidence[];
}

export interface ApiAddEvidenceInput {
  readonly nodeId: string;
  readonly type: string;
  readonly result: 'success' | 'failure' | 'partial';
  readonly duration?: string;
  readonly notes?: string;
  readonly serviceId?: string;
  readonly expiresDays?: number;
  readonly author?: string;
}
