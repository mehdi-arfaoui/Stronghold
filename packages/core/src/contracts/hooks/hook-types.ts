import type {
  ContractHookConfig,
  ContractVerdict,
  EnforcementLevel,
} from '../contract-types.js';
import type { ContractSummary } from '../contract-result-types.js';

/**
 * Notification hook port. Implementations live outside core.
 */
export interface ContractHook {
  fire(config: ContractHookConfig, payload: ContractHookPayload): Promise<void>;
}

export interface ContractHookPayload {
  readonly event: 'contract_evaluated';
  readonly timestamp: string;
  readonly strongholdVersion: string;
  readonly contract: {
    readonly service: string;
    readonly enforcement: EnforcementLevel;
    readonly verdict: ContractVerdict;
    readonly summary: ContractSummary;
  };
  readonly violations: readonly ContractViolationSummary[];
}

export interface ContractViolationSummary {
  readonly scenario: string;
  readonly failedDimensions: readonly {
    readonly dimension: string;
    readonly required: string;
    readonly actual: string | null;
    readonly reason: string;
  }[];
}
