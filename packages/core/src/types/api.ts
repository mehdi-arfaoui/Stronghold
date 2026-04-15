import type { DRPlan, DRPlanValidationReport } from '../drp/drp-types.js';
import type { GraphAnalysisReport } from './analysis.js';
import type { DriftReport } from '../drift/drift-types.js';
import type { Evidence } from '../evidence/index.js';
import type {
  GovernancePolicyDefinition,
} from '../governance/governance-types.js';
import type { GovernanceScoreComparison, RiskAcceptance } from '../governance/risk-acceptance.js';
import type { PolicyViolation } from '../governance/policy-types.js';
import type { FindingLifecycle, PostureTrend, ScanSnapshot, ServiceTrend } from '../history/index.js';
import type {
  FullChainResult,
  ProofOfRecoveryResult,
  RealityGapResult,
  RealityGapServiceDetail,
  RecoveryChain,
} from '../scoring/index.js';
import type { ReasoningChain } from '../reasoning/index.js';
import type { ValidationReport, ValidationSeverity } from '../validation/validation-types.js';
import type { InfraNodeAttrs, ScanEdge } from './infrastructure.js';
import type { Scenario, ScenarioCoverageSummary } from '../scenarios/scenario-types.js';
import type {
  ContextualFinding,
  OwnerStatus,
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
  readonly proofOfRecovery?: ProofOfRecoveryResult;
  readonly realityGap?: RealityGapResult;
  readonly fullChainCoverage?: FullChainResult;
  readonly servicePosture?: ServicePosture;
  readonly governance?: {
    readonly riskAcceptances: readonly RiskAcceptance[];
    readonly score: GovernanceScoreComparison;
    readonly policies?: readonly GovernancePolicyDefinition[];
    readonly policyViolations?: readonly PolicyViolation[];
  };
  readonly scenarioAnalysis?: {
    readonly scenarios: readonly Scenario[];
    readonly defaultScenarioIds: readonly string[];
    readonly summary: ScenarioCoverageSummary;
  };
}

export interface ApiValidationReportResponse extends ValidationReport {
  readonly proofOfRecovery: ProofOfRecoveryResult | null;
  readonly realityGap: RealityGapResult | null;
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
  readonly realityGap?: RealityGapServiceDetail | null;
  readonly recoveryChain?: RecoveryChain | null;
  readonly reasoning?:
    | {
        readonly bullets: readonly string[];
        readonly insights: readonly string[];
        readonly conclusion: string;
        readonly nextAction: string | null;
      }
    | null;
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

export interface ApiServiceReasoningResponse {
  readonly scanId: string;
  readonly generatedAt: string;
  readonly chain: ReasoningChain;
}

export interface ApiGovernanceOwnershipSummary {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly owner: string | null;
  readonly ownerStatus: OwnerStatus | 'declared';
  readonly confirmedAt: string | null;
  readonly nextReviewAt: string | null;
}

export interface ApiGovernancePolicySummary {
  readonly policy: GovernancePolicyDefinition;
  readonly violationCount: number;
  readonly violations: readonly PolicyViolation[];
}

export interface ApiGovernanceResponse {
  readonly generatedAt: string;
  readonly ownership: readonly ApiGovernanceOwnershipSummary[];
  readonly riskAcceptances: readonly RiskAcceptance[];
  readonly policies: readonly ApiGovernancePolicySummary[];
  readonly violations: readonly PolicyViolation[];
  readonly score: GovernanceScoreComparison | null;
}

export interface ApiGovernanceAcceptancesResponse {
  readonly generatedAt: string;
  readonly acceptances: readonly RiskAcceptance[];
}

export interface ApiGovernancePoliciesResponse {
  readonly generatedAt: string;
  readonly policies: readonly ApiGovernancePolicySummary[];
}

export interface ApiGovernanceAcceptInput {
  readonly findingKey: string;
  readonly acceptedBy: string;
  readonly justification: string;
  readonly expiresDays: number;
}

export interface ApiGovernanceAcceptResult {
  readonly acceptanceId: string;
  readonly expiresAt: string;
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

export interface ApiHistoryResponse {
  readonly snapshots: readonly ScanSnapshot[];
  readonly total: number;
}

export interface ApiHistoryTrendResponse {
  readonly snapshots: readonly ScanSnapshot[];
  readonly trend: PostureTrend;
}

export interface ApiServiceHistorySnapshot {
  readonly timestamp: string;
  readonly score: number;
  readonly grade: string;
  readonly findingCount: number;
  readonly criticalFindingCount: number;
  readonly resourceCount: number;
  readonly debt?: number;
}

export interface ApiServiceHistoryResponse {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly snapshots: readonly ApiServiceHistorySnapshot[];
  readonly lifecycles: readonly FindingLifecycle[];
  readonly trend: ServiceTrend | null;
}
