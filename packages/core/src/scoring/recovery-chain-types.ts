import type { DRPlan } from '../drp/drp-types.js';
import type { Evidence } from '../evidence/index.js';
import type { ServicePosture } from '../services/index.js';
import type { InfraEdgeAttrs, InfraNodeAttrs, ScanEdge } from '../types/index.js';
import type { ValidationReport } from '../validation/index.js';

export type EvidenceRecord = Evidence;

export type RecoveryStepStatus = 'proven' | 'observed' | 'blocked' | 'unknown';

export type RecoveryStepRole = 'datastore' | 'compute' | 'network' | 'storage' | 'other';

export interface RecoveryStep {
  /** Position in the recovery order (1-based) */
  readonly position: number;
  /** Node ID of the resource */
  readonly nodeId: string;
  /** Human-readable resource name */
  readonly resourceName: string;
  /** Resource type (rds, lambda, s3, etc.) */
  readonly resourceType: string;
  /** Resource role in the service */
  readonly role: RecoveryStepRole;
  /** What recovery action is needed */
  readonly recoveryAction: string;
  /** Status of this step */
  readonly status: RecoveryStepStatus;
  /** Why this status — human-readable */
  readonly statusReason: string;
  /** Days since last tested evidence (null if never tested) */
  readonly daysSinceLastTest: number | null;
  /** Failing rules blocking this step (empty if not blocked) */
  readonly blockingRules: readonly string[];
  /** Weight: datastore=4, compute=3, storage=2, network=1, other=1 */
  readonly weight: number;
}

export interface RecoveryChain {
  readonly serviceId: string;
  readonly serviceName: string;
  /** Total steps in the recovery chain */
  readonly totalSteps: number;
  /** Steps with status 'proven' */
  readonly provenSteps: number;
  /** Steps with status 'observed' */
  readonly observedSteps: number;
  /** Steps with status 'blocked' */
  readonly blockedSteps: number;
  /** Steps with status 'unknown' */
  readonly unknownSteps: number;
  /** Weighted coverage: sum(proven step weights) / sum(all step weights) × 100 */
  readonly weightedCoverage: number;
  /** Unweighted coverage: provenSteps / totalSteps × 100 */
  readonly unweightedCoverage: number;
  /** Ordered list of steps */
  readonly steps: readonly RecoveryStep[];
  /** External dependencies note — always present */
  readonly disclaimer: string;
}

export interface FullChainResult {
  /** Per-service chains */
  readonly chains: readonly RecoveryChain[];
  /** Aggregate: services with >0 blocked steps */
  readonly servicesWithBlockedSteps: number;
  /** Aggregate: services with 100% proven (weighted) */
  readonly servicesFullyProven: number;
  /** Aggregate: total proven steps / total steps across all services */
  readonly globalUnweightedCoverage: number;
  /** Aggregate: weighted version */
  readonly globalWeightedCoverage: number;
}

export interface CalculateFullChainCoverageInput {
  readonly nodes: readonly InfraNodeAttrs[];
  readonly edges: ReadonlyArray<InfraEdgeAttrs | ScanEdge>;
  readonly validationReport: ValidationReport;
  readonly servicePosture: ServicePosture;
  readonly drpPlan: DRPlan | null;
  readonly evidenceRecords: readonly EvidenceRecord[] | null;
}
