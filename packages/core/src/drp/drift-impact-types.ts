import type { DriftReport } from '../drift/drift-types.js';
import type { DRPlan, InfrastructureNode, RTOEstimate } from './drp-types.js';

export interface DriftImpactRtoChange {
  readonly before: string | null;
  readonly after: string | null;
  readonly source: string | null;
  readonly confidence: 'documented' | 'informed' | 'unverified';
  readonly reason: string;
}

export interface DriftImpact {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly driftType: string;
  readonly drpSections: readonly string[];
  readonly impact: 'informational' | 'degraded' | 'invalidated';
  readonly message: string;
  readonly estimatedRtoChange?: DriftImpactRtoChange;
}

export interface AnalyzeDrpImpactOptions {
  readonly drpPlan?: DRPlan | null;
  readonly baselineNodes?: readonly InfrastructureNode[];
  readonly currentNodes?: readonly InfrastructureNode[];
}

export interface DriftImpactAnalysis {
  readonly impacts: readonly DriftImpact[];
  readonly status: 'current' | 'stale' | 'missing_drp';
  readonly affectedSections: readonly string[];
  readonly message: string;
}

export interface RtoEvidence {
  readonly value: string | null;
  readonly source: string | null;
  readonly confidence: RTOEstimate['confidence'] | 'unverified';
}

export interface DriftImpactContext {
  readonly report: DriftReport;
  readonly baselineNodes: ReadonlyMap<string, InfrastructureNode>;
  readonly currentNodes: ReadonlyMap<string, InfrastructureNode>;
  readonly drpPlan: DRPlan;
}
