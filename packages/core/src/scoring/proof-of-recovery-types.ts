import type { Criticality } from '../services/index.js';
import type { ServicePosture } from '../services/index.js';
import type { ValidationReport } from '../validation/index.js';

export interface ProofOfRecoveryServiceResult {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly criticality: Criticality;
  readonly hasTestedEvidence: boolean;
  readonly hasObservedEvidence: boolean;
  /** Passing rules backed by non-expired tested evidence. */
  readonly testedRuleCount: number;
  /** Passing rules evaluated for this service. */
  readonly totalRuleCount: number;
}

export interface ProofOfRecoveryResult {
  /** Percentage 0-100 of critical services backed by current tested evidence. */
  readonly proofOfRecovery: number | null;
  /** Percentage 0-100 of all services backed by current tested evidence. */
  readonly proofOfRecoveryAll: number | null;
  /** Percentage 0-100 of passing rules backed by observed evidence. */
  readonly observedCoverage: number;
  /** Service-level breakdown of tested versus observed proof. */
  readonly perService: readonly ProofOfRecoveryServiceResult[];
}

export interface CalculateProofOfRecoveryInput {
  readonly validationReport: ValidationReport;
  readonly servicePosture?: ServicePosture | null;
}
