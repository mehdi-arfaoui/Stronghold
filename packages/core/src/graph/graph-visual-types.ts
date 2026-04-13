import type { GovernanceState } from '../governance/risk-acceptance.js';
import type { ProofOfRecoveryResult } from '../scoring/proof-of-recovery-types.js';
import type {
  Scenario,
  ScenarioAnalysis,
  ScenarioCoverageSummary,
  ScenarioType,
} from '../scenarios/scenario-types.js';
import type { ResourceRole, ServicePosture } from '../services/index.js';
import type { EdgeProvenance, ScanResult, Severity } from '../types/infrastructure.js';
import type {
  Grade,
  ValidationReport,
  ValidationSeverity,
  ValidationStatus,
} from '../validation/validation-types.js';

export interface VisualNodeFinding {
  readonly ruleId: string;
  readonly severity: ValidationSeverity;
  readonly status: ValidationStatus;
  readonly message: string;
  readonly remediation: string | null;
}

export interface VisualNode {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly serviceId: string | null;
  readonly serviceName: string | null;
  readonly criticality: string;
  readonly drScore: number | null;
  readonly role: ResourceRole;
  readonly region: string;
  readonly az: string | null;
  readonly x: number;
  readonly y: number;
  readonly findingCount: number;
  readonly worstSeverity: Severity | null;
  readonly findings: readonly VisualNodeFinding[];
  readonly recommendations: readonly string[];
}

export interface VisualEdge {
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly provenance: EdgeProvenance;
}

export interface VisualService {
  readonly id: string;
  readonly name: string;
  readonly score: number;
  readonly grade: Grade;
  readonly criticality: string;
  readonly findingCount: number;
  readonly worstSeverity: Severity | null;
  readonly nodeIds: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface VisualScenario {
  readonly id: string;
  readonly name: string;
  readonly type: ScenarioType;
  readonly verdict: string;
  readonly affectedNodeIds: readonly string[];
  readonly directlyAffectedNodeIds: readonly string[];
  readonly cascadeNodeIds: readonly string[];
  readonly downServices: readonly string[];
  readonly degradedServices: readonly string[];
  readonly summary: string | null;
}

export interface GraphVisualData {
  readonly nodes: readonly VisualNode[];
  readonly edges: readonly VisualEdge[];
  readonly services: readonly VisualService[];
  readonly globalScore: number;
  readonly globalGrade: Grade;
  readonly proofOfRecovery: number | null;
  readonly observedCoverage: number;
  readonly scanDate: string;
  readonly scenarios: readonly VisualScenario[];
}

export interface GraphVisualSource {
  readonly provider: ScanResult['provider'];
  readonly nodes: readonly ScanResult['nodes'][number][];
  readonly edges: readonly ScanResult['edges'][number][];
  readonly scannedAt?: Date;
  readonly timestamp?: string;
  readonly validationReport?: ValidationReport;
  readonly proofOfRecovery?: ProofOfRecoveryResult;
  readonly servicePosture?: ServicePosture;
  readonly governance?: Pick<GovernanceState, 'score'> | null;
  readonly scenarioAnalysis?:
    | ScenarioAnalysis
    | {
        readonly scenarios: readonly Scenario[];
        readonly defaultScenarioIds: readonly string[];
        readonly summary: ScenarioCoverageSummary;
      }
    | null;
}
