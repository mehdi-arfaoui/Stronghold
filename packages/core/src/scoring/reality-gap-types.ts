import type { DRPlan } from '../drp/drp-types.js';
import type { Criticality, ServicePosture } from '../services/index.js';
import type { ScenarioAnalysis } from '../scenarios/scenario-types.js';
import type { InfraNodeAttrs } from '../types/infrastructure.js';
import type { ValidationReport } from '../validation/index.js';

export interface RealityGapResult {
  /** Config-based pass rate (0-100). What config-only tools report. */
  readonly claimedProtection: number;
  /** Proven recoverability (0-100). What Stronghold can actually prove. */
  readonly provenRecoverability: number | null;
  /** The gap: claimed - proven. Higher = more illusion. */
  readonly realityGap: number | null;
  /** Per-service breakdown */
  readonly perService: readonly RealityGapServiceDetail[];
}

export interface RealityGapServiceDetail {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly criticality: Criticality;
  readonly claimedProtection: number;
  readonly provenRecoverability: number;
  readonly realityGap: number;
  /** Flags explaining why proven recoverability is low */
  readonly gaps: readonly RealityGapReason[];
}

export type RealityGapReason =
  | { readonly type: 'no_tested_evidence'; readonly detail: string }
  | { readonly type: 'expired_evidence'; readonly detail: string; readonly daysExpired: number }
  | {
      readonly type: 'scenario_uncovered';
      readonly scenarioId: string;
      readonly scenarioName: string;
    }
  | { readonly type: 'runbook_broken'; readonly staleResources: readonly string[] }
  | { readonly type: 'unmitigated_spof'; readonly nodeId: string; readonly blastRadius: number }
  | { readonly type: 'no_cross_region'; readonly detail: string }
  | { readonly type: 'single_az'; readonly detail: string };

export interface CalculateRealityGapInput {
  readonly nodes: readonly InfraNodeAttrs[];
  readonly validationReport: ValidationReport;
  readonly servicePosture?: ServicePosture | null;
  readonly scenarioAnalysis?: ScenarioAnalysis | null;
  readonly drpPlan?: DRPlan | null;
}
