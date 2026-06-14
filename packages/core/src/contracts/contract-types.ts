/**
 * Typed representation of a contracts.yml file after parsing and validation.
 */

/** Evidence levels, ordered from weakest to strongest. */
export type EvidenceLevel = 'inferred' | 'observed' | 'declared' | 'tested';

/** Chain coverage levels, ordered from weakest to strongest. */
export type ChainCoverageLevel = 'partial' | 'observed' | 'proven';

/** SPOF tolerance. */
export type SpofTolerance = 'any' | 'mitigated' | 'none';

/** Enforcement levels. */
export type EnforcementLevel = 'warn' | 'enforce' | 'hook';

/** Events that trigger a hook. */
export type HookTriggerEvent = 'met' | 'violated' | 'unknown';

/** Possible verdicts for one requirement. */
export type ContractVerdict = 'met' | 'violated' | 'unknown' | 'not_applicable';

/**
 * Duration parsed from a human-readable format such as 1h, 30m, or 1h30m.
 * Stored in milliseconds for deterministic comparisons.
 */
export interface ParsedDuration {
  readonly raw: string;
  readonly totalMs: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

/** Webhook hook configuration. */
export interface ContractHookConfig {
  readonly type: 'webhook';
  readonly url: string;
  readonly on: readonly HookTriggerEvent[];
}

/**
 * One requirement inside a contract. Each dimension is optional; missing
 * dimensions are represented as null rather than undefined.
 */
export interface ContractRequirement {
  readonly scenario: string;
  readonly rto: ParsedDuration | null;
  readonly rpo: ParsedDuration | null;
  readonly evidence: EvidenceLevel | null;
  readonly chainCoverage: ChainCoverageLevel | null;
  readonly spof: SpofTolerance | null;
}

/** A complete contract targeting one service name or service glob. */
export interface Contract {
  readonly service: string;
  readonly description: string | null;
  readonly owner: string | null;
  readonly enforcement: EnforcementLevel;
  readonly hook: ContractHookConfig | null;
  readonly requirements: readonly ContractRequirement[];
}

/** Parsed and validated contracts.yml contents. */
export interface ContractsConfig {
  readonly version: string;
  readonly contracts: readonly Contract[];
}

/** Result of loading a contracts file. */
export type ContractsLoadResult =
  | { readonly status: 'loaded'; readonly config: ContractsConfig }
  | { readonly status: 'not_found' }
  | { readonly status: 'invalid'; readonly errors: readonly string[] };

/** YAML shape after schema validation and before internal mapping. */
export interface RawContractsConfig {
  readonly version: '1';
  readonly contracts: readonly RawContract[];
}

export interface RawContract {
  readonly service: string;
  readonly description?: string;
  readonly owner?: string;
  readonly enforcement?: EnforcementLevel;
  readonly hook?: RawContractHookConfig;
  readonly requirements: readonly RawContractRequirement[];
}

export interface RawContractHookConfig {
  readonly type: 'webhook';
  readonly url: string;
  readonly on: readonly HookTriggerEvent[];
}

export interface RawContractRequirement {
  readonly scenario: string;
  readonly rto?: string;
  readonly rpo?: string;
  readonly evidence?: EvidenceLevel;
  readonly chain_coverage?: ChainCoverageLevel;
  readonly spof?: SpofTolerance;
}

export const EVIDENCE_ORDER: Record<EvidenceLevel, number> = {
  inferred: 0,
  observed: 1,
  declared: 2,
  tested: 3,
};

export const CHAIN_COVERAGE_ORDER: Record<ChainCoverageLevel, number> = {
  partial: 0,
  observed: 1,
  proven: 2,
};

export function isEvidenceSufficient(actual: EvidenceLevel, required: EvidenceLevel): boolean {
  return EVIDENCE_ORDER[actual] >= EVIDENCE_ORDER[required];
}

export function isChainCoverageSufficient(
  actual: ChainCoverageLevel,
  required: ChainCoverageLevel,
): boolean {
  return CHAIN_COVERAGE_ORDER[actual] >= CHAIN_COVERAGE_ORDER[required];
}
