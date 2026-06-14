import {
  isChainCoverageSufficient,
  type ChainCoverageLevel,
} from '../contract-types.js';
import type {
  CoverageDetailInfo,
  DimensionResult,
  ProofOfRecoveryInfo,
  ServiceInfo,
} from '../contract-result-types.js';

export type DerivedChainCoverageLevel = ChainCoverageLevel | 'uncovered' | null;

export function evaluateChainCoverageRequirement(
  required: ChainCoverageLevel,
  coverage: CoverageDetailInfo | null,
  proof: ProofOfRecoveryInfo | null,
  service: ServiceInfo,
): DimensionResult {
  const actual = deriveChainCoverageLevel(coverage, proof);

  if (actual === null) {
    return {
      dimension: 'chain_coverage',
      verdict: 'unknown',
      required,
      actual: null,
      source: 'not_available',
      reason: `No chain coverage data is available for ${service.serviceName}.`,
    };
  }

  if (actual === 'uncovered') {
    return {
      dimension: 'chain_coverage',
      verdict: 'violated',
      required,
      actual,
      source: 'graph_analysis',
      reason: `Recovery chain is uncovered for ${service.serviceName}; missing capabilities: ${formatMissingCapabilities(coverage)}.`,
    };
  }

  const verdict = isChainCoverageSufficient(actual, required) ? 'met' : 'violated';
  const comparison = verdict === 'met' ? 'satisfies' : 'does not satisfy';

  return {
    dimension: 'chain_coverage',
    verdict,
    required,
    actual,
    source: 'graph_analysis',
    reason: `Derived chain coverage ${actual} ${comparison} required level ${required} for ${service.serviceName}.`,
  };
}

export function deriveChainCoverageLevel(
  coverage: CoverageDetailInfo | null,
  proof: ProofOfRecoveryInfo | null,
): DerivedChainCoverageLevel {
  if (coverage === null) {
    return null;
  }

  switch (coverage.verdict) {
    case 'covered':
      if (proof?.hasTestedEvidence === true) {
        return 'proven';
      }
      if (proof?.hasObservedEvidence === true) {
        return 'observed';
      }
      return 'partial';
    case 'partially_covered':
    case 'degraded':
      return 'partial';
    case 'uncovered':
      return 'uncovered';
  }
}

function formatMissingCapabilities(coverage: CoverageDetailInfo | null): string {
  if (!coverage || coverage.missingCapabilities.length === 0) {
    return 'none reported';
  }

  return coverage.missingCapabilities.join(', ');
}
