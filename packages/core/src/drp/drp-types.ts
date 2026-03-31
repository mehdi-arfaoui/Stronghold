import type { InfraNodeAttrs } from '../types/index.js';

/** Infrastructure node alias used by DRP generation and validation. */
export type InfrastructureNode = InfraNodeAttrs;

/** Deterministic recovery strategy inferred from current infrastructure metadata. */
export type RecoveryStrategy =
  | 'aurora_failover'
  | 'aurora_global_failover'
  | 'failover'
  | 'restore_from_backup'
  | 'rebuild'
  | 'dns_failover'
  | 'auto_scaling'
  | 'manual'
  | 'none';

/** Recovery posture strategy used by the honest RTO/RPO estimator. */
export type RecoveryStrategyType =
  | 'aurora_failover'
  | 'aurora_global_failover'
  | 'hot_standby'
  | 'warm_standby'
  | 'backup_restore'
  | 'full_rebuild'
  | 'failover'
  | 'dns_failover'
  | 'auto_scaling'
  | 'manual'
  | 'none';

/** Atomic recovery action supported by the MVP DRP runbook format. */
export type RecoveryActionType =
  | 'verify_status'
  | 'promote_replica'
  | 'restore_snapshot'
  | 'update_dns'
  | 'verify_connectivity'
  | 'verify_data_integrity'
  | 'scale_up'
  | 'failover_cache'
  | 'rotate_secrets'
  | 'manual_intervention';

/** Validation hints attached to a recovery action. */
export interface RecoveryValidation {
  readonly endpoint?: string;
  readonly query?: string;
  readonly expectedStatus?: number;
  readonly command?: string;
}

/** A single recovery action in execution order. */
export interface RecoveryAction {
  readonly action: RecoveryActionType;
  readonly target: string;
  readonly description: string;
  readonly timeout: string;
  readonly rollbackAction?: string;
  readonly validation?: RecoveryValidation;
}

/** A validation probe attached to a recovered service. */
export interface ValidationTest {
  readonly name: string;
  readonly type: 'health_check' | 'connectivity' | 'data_integrity' | 'dns_resolution' | 'custom';
  readonly target: string;
  readonly description: string;
  readonly timeout: string;
}

/** Source used to justify a recovery factor. */
export type RTOFactorSource =
  | { readonly type: 'aws_documentation'; readonly url: string }
  | { readonly type: 'aws_sla'; readonly url: string }
  | { readonly type: 'observed'; readonly description: string }
  | { readonly type: 'configuration'; readonly field: string }
  | { readonly type: 'heuristic'; readonly reasoning: string };

/** A single factor that influenced the current RTO/RPO estimate. */
export interface RTOFactor {
  readonly name: string;
  readonly value: string;
  readonly impact: string;
  readonly source: RTOFactorSource;
}

/** Structured recovery estimate with explicit uncertainty and evidence. */
export interface RTOEstimate {
  readonly rtoMinMinutes: number | null;
  readonly rtoMaxMinutes: number | null;
  readonly rpoMinMinutes: number | null;
  readonly rpoMaxMinutes: number | null;
  readonly confidence: 'documented' | 'informed' | 'unverified';
  readonly method: string;
  readonly factors: readonly RTOFactor[];
  readonly limitations: readonly string[];
}

/** Effective component and chain RTO after dependency propagation. */
export interface EffectiveRTO {
  readonly componentRTOMin: number | null;
  readonly componentRTOMax: number | null;
  readonly chainRTOMin: number | null;
  readonly chainRTOMax: number | null;
  readonly bottleneck: string | null;
  readonly chainContainsUnverified: boolean;
  readonly assumption: 'sequential_restore';
}

/** A single resource included in a DRP service. */
export interface DRPComponent {
  readonly resourceId: string;
  readonly resourceType: string;
  readonly name: string;
  readonly region: string;
  readonly recoveryStrategy: RecoveryStrategy;
  readonly recoverySteps: readonly RecoveryAction[];
  readonly estimatedRTO: string;
  readonly estimatedRPO: string;
  readonly dependencies: readonly string[];
  readonly risks: readonly string[];
  readonly rtoEstimate?: RTOEstimate;
  readonly effectiveRTO?: EffectiveRTO;
  readonly warnings?: readonly string[];
}

/** A logical service section of the generated DRP. */
export interface DRPService {
  readonly name: string;
  readonly criticality: 'critical' | 'high' | 'medium' | 'low';
  readonly rtoTarget: string;
  readonly rpoTarget: string;
  readonly components: readonly DRPComponent[];
  readonly validationTests: readonly ValidationTest[];
  readonly estimatedRTO: string;
  readonly estimatedRPO: string;
  readonly recoveryOrder: readonly string[];
}

/** YAML-first DRP document generated from the infrastructure graph. */
export interface DRPlan {
  readonly id: string;
  readonly version: string;
  readonly generated: string;
  readonly infrastructureHash: string;
  readonly provider: string;
  readonly regions: readonly string[];
  readonly services: readonly DRPService[];
  readonly metadata: {
    readonly totalResources: number;
    readonly coveredResources: number;
    readonly uncoveredResources: readonly string[];
    readonly worstCaseRTO: string;
    readonly averageRPO: string;
    readonly lastValidated?: string;
    readonly stale: boolean;
    readonly staleReason?: string;
  };
}

/** A single issue detected while validating a DRP against current infrastructure. */
export interface DRPlanValidationIssue {
  readonly code: 'infrastructure_hash_changed' | 'missing_component' | 'strategy_changed';
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly resourceId?: string;
  readonly description: string;
  readonly expected?: string;
  readonly actual?: string;
}

/** Validation report for a previously generated DRP. */
export interface DRPlanValidationReport {
  readonly isValid: boolean;
  readonly valid: boolean;
  readonly stale: boolean;
  readonly planInfrastructureHash: string;
  readonly currentInfrastructureHash: string;
  readonly missingComponents: readonly string[];
  readonly outdatedStrategies: readonly string[];
  readonly issues: readonly DRPlanValidationIssue[];
}

/** Successful DRP deserialization result. */
export interface DeserializeDrPlanSuccess {
  readonly ok: true;
  readonly value: DRPlan;
}

/** Failed DRP deserialization result. */
export interface DeserializeDrPlanFailure {
  readonly ok: false;
  readonly errors: readonly string[];
}

/** Result of parsing and validating a DRP YAML or JSON document. */
export type DeserializeDrPlanResult = DeserializeDrPlanSuccess | DeserializeDrPlanFailure;
