import type { DRPlan, DRPlanValidationReport } from '../drp/drp-types.js';
import type { GraphAnalysisReport } from './analysis.js';
import type { DriftReport } from '../drift/drift-types.js';
import type { ValidationReport, ValidationSeverity } from '../validation/validation-types.js';
import type { InfraNodeAttrs, ScanEdge } from './infrastructure.js';

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
