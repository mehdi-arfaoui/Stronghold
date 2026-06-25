import type {
  Contract,
  ContractHookConfig,
  ContractRequirement,
  ContractVerdict,
  HookTriggerEvent,
} from './contract-types.js';

export interface DimensionResult {
  readonly dimension: 'rto' | 'rpo' | 'evidence' | 'chain_coverage' | 'spof';
  readonly verdict: ContractVerdict;
  readonly required: string;
  readonly actual: string | null;
  readonly source: 'measured' | 'derived' | 'graph_analysis' | 'not_available';
  readonly reason: string;
}

export interface RequirementEvaluationResult {
  readonly requirement: ContractRequirement;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly verdict: ContractVerdict;
  readonly dimensions: readonly DimensionResult[];
  readonly summary: string;
}

export interface ContractEvaluationResult {
  readonly contract: Contract;
  readonly matchedServices: readonly string[];
  readonly results: readonly RequirementEvaluationResult[];
  readonly summary: ContractSummary;
}

export interface ContractSummary {
  readonly met: number;
  readonly violated: number;
  readonly unknown: number;
  readonly notApplicable: number;
  readonly total: number;
}

export interface AllContractsEvaluationResult {
  readonly contractResults: readonly ContractEvaluationResult[];
  readonly globalSummary: ContractSummary;
  readonly hasEnforceableViolations: boolean;
  readonly enforceableViolations: readonly RequirementEvaluationResult[];
  readonly hooksFired: readonly ContractHookFireInfo[];
}

export interface ContractHookFireInfo {
  readonly contractService: string;
  readonly hook: Pick<ContractHookConfig, 'type'>;
  readonly trigger: HookTriggerEvent;
}

export interface ContractEvaluationInput {
  readonly services: readonly ServiceInfo[];
  readonly evidenceByService: ReadonlyMap<string, readonly EvidenceRecordInfo[]>;
  readonly scenarioCoverage: ReadonlyMap<string, readonly CoverageDetailInfo[]>;
  readonly proofOfRecovery: ReadonlyMap<string, ProofOfRecoveryInfo>;
  readonly spofsByService: ReadonlyMap<string, readonly SpofInfo[]>;
}

export interface ServiceInfo {
  readonly serviceId: string;
  readonly serviceName: string;
}

export interface EvidenceRecordInfo {
  readonly id: string;
  readonly serviceId: string;
  readonly type: string;
  readonly scenario: string | null;
  /** Measured recovery time objective in minutes. */
  readonly measuredRTO: number | null;
  /** Measured recovery point objective in minutes. */
  readonly measuredRPO: number | null;
  readonly testedAt: string;
  readonly testedBy: string | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly expired: boolean;
}

export interface CoverageDetailInfo {
  readonly serviceId: string;
  readonly verdict: 'covered' | 'partially_covered' | 'uncovered' | 'degraded';
  readonly evidenceLevel: string;
  readonly missingCapabilities: readonly string[];
}

export interface ProofOfRecoveryInfo {
  readonly hasTestedEvidence: boolean;
  readonly hasObservedEvidence: boolean;
  readonly testedRuleCount: number;
  readonly totalRuleCount: number;
}

export interface SpofInfo {
  readonly nodeArn: string;
  readonly mitigated: boolean;
}
