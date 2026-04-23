import type {
  CrossAccountEdge,
  GovernanceState,
  ProofOfRecoveryResult,
  ScoreBreakdown,
  Service,
  ServiceScoringResult,
  WeightedValidationResult,
} from '@stronghold-dr/core';

import type { ScanResults } from '../storage/file-store.js';

export const STRONGHOLD_JSON_VERSION = '2.0.0';

export interface AccountSummary {
  readonly accountId: string;
  readonly alias: string | null;
  readonly region: string;
  readonly status: 'success' | 'failed';
  readonly resourceCount: number;
  readonly findingCount: number;
  readonly durationMs: number;
  readonly error?: string;
  readonly detail?: AccountScanDetail;
}

export interface AccountScanDetail {
  readonly scannersExecuted: readonly string[];
  readonly scannersSkipped: readonly {
    readonly scannerName: string;
    readonly reason: string;
  }[];
}

export interface SerializedAccountScanError {
  readonly accountId: string;
  readonly alias: string | null;
  readonly phase: string;
  readonly message: string;
  readonly timestamp: string;
}

export interface CrossAccountSummaryJson {
  readonly total: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly complete: number;
  readonly partial: number;
  readonly critical: number;
  readonly degraded: number;
  readonly informational: number;
}

export interface CrossAccountJson {
  readonly edges: readonly CrossAccountEdge[];
  readonly summary: CrossAccountSummaryJson;
}

export interface MultiAccountSummaryJson {
  readonly totalAccounts: number;
  readonly successfulAccounts: number;
  readonly failedAccounts: number;
  readonly totalResources: number;
  readonly resourcesByAccount: Readonly<Record<string, number>>;
  readonly totalFindings: number;
  readonly findingsByAccount: Readonly<Record<string, number>>;
  readonly crossAccountEdges: number;
}

export interface CanonicalScoringResult {
  readonly validation: ScoreBreakdown;
  readonly governance: GovernanceState['score'] | null;
  readonly services: ServiceScoringResult | null;
}

export interface CanonicalScanJsonOutput {
  readonly scan: {
    readonly version: string;
    readonly scannedAt: string;
    readonly durationMs: number;
    readonly accounts: readonly AccountSummary[];
    readonly errors: readonly SerializedAccountScanError[];
    readonly summary: MultiAccountSummaryJson;
  };
  readonly graph: {
    readonly nodes: ScanResults['nodes'];
    readonly edges: ScanResults['edges'];
    readonly crossAccount: CrossAccountJson;
  };
  readonly findings: readonly WeightedValidationResult[];
  readonly services: readonly Service[];
  readonly scoring: CanonicalScoringResult;
  readonly realityGap: ProofOfRecoveryResult | null;
}

export interface SingleAccountSerializationContext {
  readonly accountId?: string;
  readonly alias?: string | null;
  readonly region?: string;
  readonly durationMs?: number;
}

export interface SingleAccountScanResult {
  readonly kind: 'single-account';
  readonly results: ScanResults;
  readonly account?: SingleAccountSerializationContext;
}

export interface MultiAccountScanSerializationMetadata {
  readonly accounts: readonly AccountSummary[];
  readonly errors: readonly SerializedAccountScanError[];
  readonly crossAccount: CrossAccountJson;
  readonly summary: MultiAccountSummaryJson;
}

export interface CanonicalMultiAccountScanResult extends MultiAccountScanSerializationMetadata {
  readonly kind: 'multi-account';
  readonly results: ScanResults;
}

export type CanonicalScanSerializationInput =
  | ScanResults
  | SingleAccountScanResult
  | CanonicalMultiAccountScanResult;
