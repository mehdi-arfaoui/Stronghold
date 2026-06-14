import {
  isEvidenceSufficient,
  type EvidenceLevel,
} from '../contract-types.js';
import type {
  DimensionResult,
  ProofOfRecoveryInfo,
  ServiceInfo,
} from '../contract-result-types.js';

export function evaluateEvidenceRequirement(
  required: EvidenceLevel,
  proof: ProofOfRecoveryInfo | null,
  service: ServiceInfo,
): DimensionResult {
  const actual = deriveEvidenceLevel(proof);

  if (actual === null) {
    return {
      dimension: 'evidence',
      verdict: 'unknown',
      required,
      actual: null,
      source: 'not_available',
      reason: `No proof-of-recovery evidence data is available for ${service.serviceName}.`,
    };
  }

  const verdict = isEvidenceSufficient(actual, required) ? 'met' : 'violated';
  const comparison = verdict === 'met' ? 'satisfies' : 'does not satisfy';

  return {
    dimension: 'evidence',
    verdict,
    required,
    actual,
    source: 'derived',
    reason: `Evidence level ${actual} ${comparison} required level ${required} for ${service.serviceName}.`,
  };
}

export function deriveEvidenceLevel(
  proof: ProofOfRecoveryInfo | null,
): EvidenceLevel | null {
  if (proof === null) {
    return null;
  }

  if (proof.hasTestedEvidence) {
    return 'tested';
  }

  if (proof.hasObservedEvidence) {
    return 'observed';
  }

  if (proof.totalRuleCount > 0) {
    return 'inferred';
  }

  return null;
}
