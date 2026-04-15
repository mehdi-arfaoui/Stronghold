import type { GovernanceState } from '../governance/risk-acceptance.js';
import type { FindingLifecycle } from '../history/finding-lifecycle-types.js';
import type { DRPlan } from '../drp/drp-types.js';
import type { FullChainResult, RecoveryStepStatus } from '../scoring/recovery-chain-types.js';
import type { RealityGapResult } from '../scoring/reality-gap-types.js';
import type { ReasoningScanResult } from '../reasoning/reasoning-types.js';
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
  readonly claimedProtection: number;
  readonly provenRecoverability: number;
  readonly realityGap: number;
  readonly findingCount: number;
  readonly worstSeverity: Severity | null;
  readonly nodeIds: readonly string[];
  readonly reasoning: readonly string[];
  readonly insights: readonly string[];
  readonly conclusion: string;
  readonly nextAction: string | null;
  readonly recoveryChain: {
    readonly totalSteps: number;
    readonly provenSteps: number;
    readonly weightedCoverage: number;
    readonly steps: ReadonlyArray<{
      readonly resourceName: string;
      readonly status: RecoveryStepStatus;
      readonly statusReason: string;
    }>;
  } | null;
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
  readonly claimedProtection: number;
  readonly provenRecoverability: number | null;
  readonly realityGap: number | null;
  readonly proofOfRecovery: number | null;
  readonly observedCoverage: number;
  readonly recoveryChain: {
    readonly totalSteps: number;
    readonly provenSteps: number;
    readonly weightedCoverage: number;
    readonly unweightedCoverage: number;
  } | null;
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
  readonly realityGap?: RealityGapResult;
  readonly fullChainCoverage?: FullChainResult | null;
  readonly drpPlan?: DRPlan | null;
  readonly servicePosture?: ServicePosture;
  readonly governance?: Pick<GovernanceState, 'score'> | null;
  readonly previousScanResult?: ReasoningScanResult | null;
  readonly findingLifecycles?: readonly FindingLifecycle[] | null;
  readonly scenarioAnalysis?:
    | ScenarioAnalysis
    | {
        readonly scenarios: readonly Scenario[];
        readonly defaultScenarioIds: readonly string[];
        readonly summary: ScenarioCoverageSummary;
      }
    | null;
}
