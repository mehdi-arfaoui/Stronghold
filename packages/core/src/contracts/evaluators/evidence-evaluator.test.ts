import { describe, expect, it } from 'vitest';

import type { ProofOfRecoveryInfo, ServiceInfo } from '../contract-result-types.js';
import { evaluateEvidenceRequirement } from './evidence-evaluator.js';

const SERVICE: ServiceInfo = {
  serviceId: 'svc-payment',
  serviceName: 'payment-processing',
};

describe('evaluateEvidenceRequirement', () => {
  it('returns met when required observed and actual tested', () => {
    const result = evaluateEvidenceRequirement('observed', proof({ hasTestedEvidence: true }), SERVICE);

    expect(result.verdict).toBe('met');
    expect(result.actual).toBe('tested');
  });

  it('returns met when required observed and actual observed', () => {
    const result = evaluateEvidenceRequirement('observed', proof({ hasObservedEvidence: true }), SERVICE);

    expect(result.verdict).toBe('met');
    expect(result.actual).toBe('observed');
  });

  it('returns violated when required tested and actual observed', () => {
    const result = evaluateEvidenceRequirement('tested', proof({ hasObservedEvidence: true }), SERVICE);

    expect(result.verdict).toBe('violated');
    expect(result.actual).toBe('observed');
  });

  it('returns violated when required observed and actual inferred', () => {
    const result = evaluateEvidenceRequirement('observed', proof({ totalRuleCount: 1 }), SERVICE);

    expect(result.verdict).toBe('violated');
    expect(result.actual).toBe('inferred');
  });

  it('returns unknown without proof-of-recovery data', () => {
    const result = evaluateEvidenceRequirement('observed', null, SERVICE);

    expect(result.verdict).toBe('unknown');
    expect(result.actual).toBeNull();
    expect(result.source).toBe('not_available');
  });
});

function proof(overrides: Partial<ProofOfRecoveryInfo> = {}): ProofOfRecoveryInfo {
  return {
    hasTestedEvidence: false,
    hasObservedEvidence: false,
    testedRuleCount: 0,
    totalRuleCount: 0,
    ...overrides,
  };
}
