import type { EvidenceMaturitySummary, Grade, ValidationReport } from '../validation/index.js';
import type { ScenarioAnalysis } from '../scenarios/index.js';
import type { GovernanceState } from '../governance/index.js';
import type { RealityGapResult } from '../scoring/index.js';
import type { ServicePosture } from '../services/index.js';

export interface ServiceSnapshot {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly score: number;
  readonly grade: Grade;
  readonly findingCount: number;
  readonly criticalFindingCount: number;
  readonly resourceCount: number;
  readonly debt?: number;
}

export interface ScanSnapshot {
  readonly id: string;
  readonly timestamp: string;
  readonly globalScore: number;
  readonly globalGrade: string;
  readonly proofOfRecovery: number | null;
  readonly claimedProtection: number;
  readonly provenRecoverability: number | null;
  readonly realityGap: number | null;
  readonly observedCoverage: number;
  readonly totalResources: number;
  readonly totalFindings: number;
  readonly findingsBySeverity: Record<string, number>;
  readonly services: readonly ServiceSnapshot[];
  readonly totalDebt?: number;
  readonly scenarioCoverage: {
    readonly total: number;
    readonly covered: number;
    readonly partiallyCovered: number;
    readonly uncovered: number;
  };
  readonly governance?: {
    readonly ownerCoverage: number;
    readonly activeAcceptances: number;
    readonly expiredAcceptances: number;
    readonly policyViolations: number;
  };
  readonly evidenceDistribution: Record<string, number>;
  readonly findingIds: readonly string[];
  readonly regions: readonly string[];
  readonly scanDurationMs: number;
  readonly scannerSuccessCount: number;
  readonly scannerFailureCount: number;
}

export interface BuildScanSnapshotInput {
  readonly scanId: string;
  readonly timestamp: string;
  readonly validationReport: ValidationReport;
  readonly totalResources: number;
  readonly regions: readonly string[];
  readonly servicePosture?: ServicePosture | null;
  readonly governance?: GovernanceState | null;
  readonly scenarioAnalysis?: ScenarioAnalysis | null;
  readonly evidenceSummary?: EvidenceMaturitySummary | null;
  readonly realityGap?: RealityGapResult | null;
  readonly scanDurationMs?: number;
  readonly scannerSuccessCount?: number;
  readonly scannerFailureCount?: number;
}

export interface HistoryQueryOptions {
  readonly limit?: number;
  readonly since?: string;
  readonly until?: string;
}

export interface HistoryStore {
  addSnapshot(snapshot: ScanSnapshot): Promise<void>;
  getSnapshots(options?: HistoryQueryOptions): Promise<readonly ScanSnapshot[]>;
  getLatest(): Promise<ScanSnapshot | null>;
  getPrevious(): Promise<ScanSnapshot | null>;
  count(): Promise<number>;
}
