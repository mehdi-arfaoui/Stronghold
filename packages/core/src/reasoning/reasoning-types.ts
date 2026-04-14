import type { DRPlan } from '../drp/drp-types.js';
import type { FindingLifecycle } from '../history/finding-lifecycle-types.js';
import type { GovernanceState } from '../governance/risk-acceptance.js';
import type { RealityGapResult } from '../scoring/reality-gap-types.js';
import type { ScenarioAnalysis } from '../scenarios/scenario-types.js';
import type { ServicePosture } from '../services/index.js';
import type { ScanEdge, ScanResult } from '../types/infrastructure.js';
import type { ValidationReport } from '../validation/index.js';

export interface ReasoningScanResult extends ScanResult {
  readonly timestamp?: string;
  readonly validationReport: ValidationReport;
  readonly servicePosture: ServicePosture;
  readonly scenarioAnalysis?: ScenarioAnalysis | null;
  readonly drpPlan?: DRPlan | null;
  readonly governance?: GovernanceState | null;
  readonly edges: ScanEdge[];
}

export interface ReasoningChain {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly score: number;
  readonly grade: string;
  readonly criticality: string;
  readonly claimedProtection: number;
  readonly provenRecoverability: number;
  readonly realityGap: number;
  readonly steps: readonly ReasoningStep[];
  readonly insights: readonly GraphInsight[];
  readonly conclusion: string;
  readonly nextAction: string | null;
}

export interface ReasoningStep {
  readonly type: ReasoningStepType;
  readonly summary: string;
  readonly detail: string | null;
  readonly severity: 'critical' | 'high' | 'medium' | 'low' | null;
  readonly confidence: number | null;
  readonly source: string | null;
}

export type ReasoningStepType =
  | 'service_composition'
  | 'critical_dependency'
  | 'finding'
  | 'evidence_gap'
  | 'scenario_impact'
  | 'runbook_status'
  | 'scoring_impact'
  | 'positive';

export interface GraphInsight {
  readonly type: GraphInsightType;
  readonly severity: 'critical' | 'high' | 'medium';
  readonly summary: string;
  readonly detail: string;
  readonly affectedServices: readonly string[];
  readonly evidence: readonly string[];
}

export type GraphInsightType =
  | 'cascade_failure'
  | 'silent_dependency_drift'
  | 'risk_acceptance_invalidation'
  | 'recovery_path_erosion';

export interface BuildReasoningChainInput {
  readonly serviceId: string;
  readonly scanResult: ReasoningScanResult;
  readonly previousScanResult: ReasoningScanResult | null;
  readonly findingLifecycles: readonly FindingLifecycle[] | null;
  readonly realityGap: RealityGapResult;
}
