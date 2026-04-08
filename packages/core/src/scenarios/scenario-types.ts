import type { DRPlan } from '../drp/drp-types.js';
import type { ComponentRunbook, DRPRunbook } from '../drp/runbook/runbook-types.js';
import type { Evidence, EvidenceType } from '../evidence/index.js';
import type { GraphInstance } from '../graph/graph-instance.js';
import type { Service } from '../services/service-types.js';
import type { GraphAnalysisReport } from '../types/analysis.js';
import type { InfraNodeAttrs } from '../types/infrastructure.js';

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: ScenarioType;
  readonly disruption: Disruption;
  readonly impact?: ScenarioImpact;
  readonly coverage?: ScenarioCoverage;
}

export type ScenarioType =
  | 'az_failure'
  | 'region_failure'
  | 'service_outage'
  | 'node_failure'
  | 'data_corruption'
  | 'custom';

export interface Disruption {
  readonly affectedNodes: readonly string[];
  readonly selectionCriteria: string;
}

export interface ScenarioImpact {
  readonly directlyAffected: readonly AffectedNode[];
  readonly cascadeAffected: readonly AffectedNode[];
  readonly totalAffectedNodes: number;
  readonly totalAffectedServices: readonly string[];
  readonly serviceImpact: readonly ServiceScenarioImpact[];
}

export interface AffectedNode {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly serviceId?: string;
  readonly reason: string;
  readonly impactType: 'direct' | 'cascade';
  readonly cascadeDepth: number;
}

export interface ServiceScenarioImpact {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly affectedResources: number;
  readonly totalResources: number;
  readonly percentageAffected: number;
  readonly criticalResourcesAffected: readonly string[];
  readonly status: 'unaffected' | 'degraded' | 'down';
}

export interface ScenarioCoverage {
  readonly verdict: CoverageVerdict;
  readonly details: readonly CoverageDetail[];
  readonly summary: string;
}

export type CoverageVerdict =
  | 'covered'
  | 'partially_covered'
  | 'uncovered'
  | 'degraded';

export interface CoverageDetail {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly verdict: CoverageVerdict;
  readonly reason: string;
  readonly recoveryPath?: string;
  readonly missingCapabilities: readonly string[];
  readonly evidenceLevel: EvidenceType;
  readonly lastTested?: string;
}

export interface ScenarioCoverageSummary {
  readonly total: number;
  readonly covered: number;
  readonly partiallyCovered: number;
  readonly uncovered: number;
  readonly degraded: number;
}

export interface ScenarioAnalysis {
  readonly scenarios: readonly Scenario[];
  readonly defaultScenarioIds: readonly string[];
  readonly summary: ScenarioCoverageSummary;
}

export interface GeneratedScenarioSet {
  readonly scenarios: readonly Scenario[];
  readonly defaultScenarioIds: readonly string[];
}

export interface RunbookValidation {
  readonly isAlive: boolean;
  readonly staleReferences: readonly StaleReference[];
}

export interface StaleReference {
  readonly stepId: string;
  readonly stepDescription: string;
  readonly referencedResourceId: string;
  readonly issue: 'resource_not_found' | 'resource_changed' | 'resource_deleted';
  readonly detail: string;
}

export interface AnalyzeScenarioInput {
  readonly graph: GraphInstance;
  readonly nodes: readonly InfraNodeAttrs[];
  readonly services: readonly Service[];
  readonly scenario: Scenario;
  readonly drp: DRPlan | null;
  readonly evidence: readonly Evidence[];
  readonly runbook?: DRPRunbook | null;
}

export interface AnalyzeScenariosInput {
  readonly graph: GraphInstance;
  readonly nodes: readonly InfraNodeAttrs[];
  readonly services: readonly Service[];
  readonly scenarios: readonly Scenario[];
  readonly defaultScenarioIds?: readonly string[];
  readonly drp: DRPlan | null;
  readonly evidence: readonly Evidence[];
  readonly runbook?: DRPRunbook | null;
}

export interface GenerateBuiltInScenariosInput {
  readonly nodes: readonly InfraNodeAttrs[];
  readonly services: readonly Service[];
  readonly analysis: GraphAnalysisReport;
}

export interface ValidateCoverageContext {
  readonly scenario: Scenario;
  readonly drp: DRPlan | null;
  readonly evidence: readonly Evidence[];
  readonly services: readonly Service[];
  readonly nodes: readonly InfraNodeAttrs[];
  readonly runbook?: DRPRunbook | null;
}

export interface ServiceCoverageContext {
  readonly service: Service;
  readonly impactedNodeIds: ReadonlySet<string>;
  readonly drpComponents: readonly string[];
  readonly componentRunbooks: readonly ComponentRunbook[];
}
