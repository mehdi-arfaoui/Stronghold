import type { DRPlan } from '../drp/drp-types.js';
import type { Evidence, EvidenceType } from '../evidence/index.js';
import type { InfraNodeAttrs } from '../types/index.js';

/** Infrastructure node alias used by the DR validation engine. */
export type InfraNode = InfraNodeAttrs;

/** Severity assigned to a validation rule. */
export type ValidationSeverity = 'critical' | 'high' | 'medium' | 'low';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

/** Disaster recovery pillar represented by a validation rule. */
export type DRCategory =
  | 'backup'
  | 'redundancy'
  | 'failover'
  | 'detection'
  | 'recovery'
  | 'replication';

/** Runtime outcome returned by an executed validation rule. */
export type ValidationStatus = 'pass' | 'fail' | 'warn' | 'skip' | 'error';

/** Lightweight edge view used by validation rules. */
export interface ValidationEdge {
  readonly source: string;
  readonly target: string;
  readonly type: string;
}

/** Shared inputs exposed to every validation rule. */
export interface ValidationContext {
  readonly allNodes: readonly InfraNode[];
  readonly edges: ReadonlyArray<ValidationEdge>;
  readonly drpPlan?: DRPlan;
  readonly backupCoverage?: ReadonlyMap<string, string>;
}

/** A single validation outcome for one node and one rule. */
export interface ValidationResult {
  readonly ruleId: string;
  readonly nodeId: string;
  readonly status: ValidationStatus;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly remediation?: string;
}

/** Transparent weighting data attached to a validation result. */
export interface WeightedValidationResult extends ValidationResult {
  readonly severity: ValidationSeverity;
  readonly category: DRCategory;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly weight: number;
  readonly weightBreakdown: {
    readonly severityWeight: number;
    readonly criticalityWeight: number;
    readonly blastRadiusWeight: number;
    readonly directDependentCount: number;
  };
}

export interface ValidationResultWithEvidence extends ValidationResult {
  readonly evidence: readonly Evidence[];
}

export interface WeightedValidationResultWithEvidence extends WeightedValidationResult {
  readonly evidence: readonly Evidence[];
  readonly weightBreakdown: WeightedValidationResult['weightBreakdown'] & {
    readonly evidenceType: EvidenceType;
    readonly evidenceConfidence: number;
  };
}

export interface EvidenceMaturitySummary {
  readonly total: number;
  readonly counts: Record<EvidenceType, number>;
  readonly potentialScore: number;
}

/** Weighted score summary for the overall posture report. */
export interface ScoreBreakdown {
  readonly overall: number;
  readonly byCategory: Record<DRCategory, number>;
  readonly grade: Grade;
  readonly weakestCategory: DRCategory;
  readonly scoringMethod: string;
  readonly disclaimer: string;
}

/** Pure validation rule executed against scanned node metadata. */
export interface ValidationRule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: DRCategory;
  readonly severity: ValidationSeverity;
  readonly appliesToTypes: readonly string[];
  readonly observedKeys?: readonly string[];
  readonly validate: (node: InfraNode, context: ValidationContext) => ValidationResult;
}

/** Aggregated report produced by the validation engine. */
export interface ValidationReport {
  readonly timestamp: string;
  readonly totalChecks: number;
  readonly passed: number;
  readonly failed: number;
  readonly warnings: number;
  readonly skipped: number;
  readonly errors: number;
  readonly results: readonly WeightedValidationResult[];
  readonly score: number;
  readonly scoreBreakdown: ScoreBreakdown;
  readonly criticalFailures: readonly WeightedValidationResult[];
  readonly scannedResources: number;
}

export interface ValidationReportWithEvidence extends ValidationReport {
  readonly results: readonly WeightedValidationResultWithEvidence[];
  readonly criticalFailures: readonly WeightedValidationResultWithEvidence[];
  readonly evidenceSummary: EvidenceMaturitySummary;
}
