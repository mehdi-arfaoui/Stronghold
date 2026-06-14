import { describe, expect, it } from 'vitest';

import type {
  CoverageDetailInfo,
  ProofOfRecoveryInfo,
  ServiceInfo,
} from '../contract-result-types.js';
import {
  deriveChainCoverageLevel,
  evaluateChainCoverageRequirement,
} from './chain-coverage-evaluator.js';

const SERVICE: ServiceInfo = {
  serviceId: 'svc-payment',
  serviceName: 'payment-processing',
};

describe('deriveChainCoverageLevel', () => {
  it('derives proven from covered with tested evidence', () => {
    expect(deriveChainCoverageLevel(coverage('covered'), proof({ hasTestedEvidence: true }))).toBe('proven');
  });

  it('derives observed from covered with observed evidence', () => {
    expect(deriveChainCoverageLevel(coverage('covered'), proof({ hasObservedEvidence: true }))).toBe('observed');
  });

  it('derives partial from covered without tested or observed evidence', () => {
    expect(deriveChainCoverageLevel(coverage('covered'), proof())).toBe('partial');
  });

  it('derives partial from partially_covered', () => {
    expect(deriveChainCoverageLevel(coverage('partially_covered'), proof({ hasTestedEvidence: true }))).toBe('partial');
  });

  it('derives partial from degraded', () => {
    expect(deriveChainCoverageLevel(coverage('degraded'), proof({ hasTestedEvidence: true }))).toBe('partial');
  });

  it('preserves uncovered as a direct violation signal', () => {
    expect(deriveChainCoverageLevel(coverage('uncovered'), proof({ hasTestedEvidence: true }))).toBe('uncovered');
  });

  it('returns null when no coverage data is available', () => {
    expect(deriveChainCoverageLevel(null, proof({ hasTestedEvidence: true }))).toBeNull();
  });
});

describe('evaluateChainCoverageRequirement', () => {
  it('returns met when required observed and derived proven', () => {
    const result = evaluateChainCoverageRequirement(
      'observed',
      coverage('covered'),
      proof({ hasTestedEvidence: true }),
      SERVICE,
    );

    expect(result.verdict).toBe('met');
    expect(result.actual).toBe('proven');
  });

  it('returns violated when required proven and derived observed', () => {
    const result = evaluateChainCoverageRequirement(
      'proven',
      coverage('covered'),
      proof({ hasObservedEvidence: true }),
      SERVICE,
    );

    expect(result.verdict).toBe('violated');
    expect(result.actual).toBe('observed');
  });

  it('returns violated when coverage is uncovered', () => {
    const result = evaluateChainCoverageRequirement(
      'partial',
      coverage('uncovered', ['Add service to DRP.']),
      proof({ hasTestedEvidence: true }),
      SERVICE,
    );

    expect(result.verdict).toBe('violated');
    expect(result.actual).toBe('uncovered');
  });

  it('returns unknown when coverage data is absent', () => {
    const result = evaluateChainCoverageRequirement(
      'partial',
      null,
      proof({ hasTestedEvidence: true }),
      SERVICE,
    );

    expect(result.verdict).toBe('unknown');
    expect(result.source).toBe('not_available');
  });
});

function coverage(
  verdict: CoverageDetailInfo['verdict'],
  missingCapabilities: readonly string[] = [],
): CoverageDetailInfo {
  return {
    serviceId: SERVICE.serviceId,
    verdict,
    evidenceLevel: 'inferred',
    missingCapabilities,
  };
}

function proof(overrides: Partial<ProofOfRecoveryInfo> = {}): ProofOfRecoveryInfo {
  return {
    hasTestedEvidence: false,
    hasObservedEvidence: false,
    testedRuleCount: 0,
    totalRuleCount: 0,
    ...overrides,
  };
}
