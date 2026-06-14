import { describe, expect, it } from 'vitest';

import type { Contract, ContractRequirement } from './contract-types.js';
import type {
  ContractEvaluationInput,
  CoverageDetailInfo,
  EvidenceRecordInfo,
  ProofOfRecoveryInfo,
  ServiceInfo,
} from './contract-result-types.js';
import { parseDuration } from './duration-parser.js';
import { evaluateContracts } from './contract-evaluator.js';
import { parseContractsYaml } from './contract-loader.js';

const PAYMENT: ServiceInfo = {
  serviceId: 'svc-payment',
  serviceName: 'payment-processing',
};

const PAYMENT_API: ServiceInfo = {
  serviceId: 'svc-payment-api',
  serviceName: 'payment-api',
};

const AUTH: ServiceInfo = {
  serviceId: 'svc-auth',
  serviceName: 'auth-service',
};

describe('ContractEvaluator service matching', () => {
  it('matches an exact service name', () => {
    const result = evaluateContracts(
      [contract({ service: 'payment-processing' })],
      input({ services: [PAYMENT, AUTH] }),
    );

    expect(result.contractResults[0]?.matchedServices).toEqual(['payment-processing']);
  });

  it('matches a glob pattern', () => {
    const result = evaluateContracts(
      [contract({ service: 'payment-*' })],
      input({ services: [PAYMENT, PAYMENT_API, AUTH] }),
    );

    expect(result.contractResults[0]?.matchedServices).toEqual([
      'payment-api',
      'payment-processing',
    ]);
  });

  it('matches wildcard *', () => {
    const result = evaluateContracts(
      [contract({ service: '*' })],
      input({ services: [PAYMENT, AUTH] }),
    );

    expect(result.contractResults[0]?.matchedServices).toEqual([
      'auth-service',
      'payment-processing',
    ]);
  });

  it('returns not_applicable when no service matches', () => {
    const result = evaluateContracts(
      [contract({ service: 'billing' })],
      input({ services: [PAYMENT] }),
    );

    expect(result.contractResults[0]?.summary.notApplicable).toBe(1);
    expect(result.contractResults[0]?.results[0]?.verdict).toBe('not_applicable');
  });
});

describe('ContractEvaluator scenario resolution', () => {
  it('evaluates an exact scenario', () => {
    const result = evaluateContracts(
      [contract({ requirements: [requirement({ scenario: 'region_failure', evidence: 'observed' })] })],
      input({
        scenarioCoverage: new Map([['region_failure', [coverage(PAYMENT)]]]),
        proofOfRecovery: new Map([[PAYMENT.serviceId, proof({ hasObservedEvidence: true })]]),
      }),
    );

    expect(result.globalSummary.met).toBe(1);
  });

  it('normalizes hyphens and underscores for scenario matching', () => {
    const result = evaluateContracts(
      [contract({ requirements: [requirement({ scenario: 'az-failure', evidence: 'observed' })] })],
      input({
        scenarioCoverage: new Map([['az_failure', [coverage(PAYMENT)]]]),
        proofOfRecovery: new Map([[PAYMENT.serviceId, proof({ hasObservedEvidence: true })]]),
      }),
    );

    expect(result.contractResults[0]?.results[0]?.verdict).toBe('met');
  });

  it('evaluates wildcard scenario against every available scenario and returns the worst verdict', () => {
    const result = evaluateContracts(
      [contract({ requirements: [requirement({ scenario: '*', rto: parseDuration('1h') })] })],
      input({
        scenarioCoverage: new Map([
          ['az_failure', [coverage(PAYMENT)]],
          ['region_failure', [coverage(PAYMENT)]],
        ]),
        evidenceByService: new Map([
          [
            PAYMENT.serviceId,
            [
              evidence({ scenario: 'az_failure', measuredRTO: 45 }),
              evidence({ scenario: 'region_failure', measuredRTO: 90 }),
            ],
          ],
        ]),
      }),
    );

    const evaluated = result.contractResults[0]?.results[0];
    expect(evaluated?.verdict).toBe('violated');
    expect(evaluated?.dimensions[0]?.actual).toBe('90m');
    expect(evaluated?.summary).toContain('region_failure');
  });

  it('returns unknown for an unrecognized scenario', () => {
    const result = evaluateContracts(
      [contract({ requirements: [requirement({ scenario: 'meteor-strike', evidence: 'observed' })] })],
      input(),
    );

    const evaluated = result.contractResults[0]?.results[0];
    expect(evaluated?.verdict).toBe('unknown');
    expect(evaluated?.summary).toContain('not recognized');
  });
});

describe('ContractEvaluator aggregation', () => {
  it('aggregates violated and met dimensions to violated', () => {
    const result = evaluateContracts(
      [
        contract({
          requirements: [
            requirement({
              rto: parseDuration('1h'),
              evidence: 'observed',
            }),
          ],
        }),
      ],
      input({
        evidenceByService: new Map([[PAYMENT.serviceId, [evidence({ measuredRTO: 90 })]]]),
        proofOfRecovery: new Map([[PAYMENT.serviceId, proof({ hasObservedEvidence: true })]]),
      }),
    );

    expect(result.contractResults[0]?.results[0]?.verdict).toBe('violated');
  });

  it('aggregates unknown and met dimensions to unknown', () => {
    const result = evaluateContracts(
      [
        contract({
          requirements: [
            requirement({
              rto: parseDuration('1h'),
              evidence: 'observed',
            }),
          ],
        }),
      ],
      input({
        evidenceByService: new Map([[PAYMENT.serviceId, []]]),
        proofOfRecovery: new Map([[PAYMENT.serviceId, proof({ hasObservedEvidence: true })]]),
      }),
    );

    expect(result.contractResults[0]?.results[0]?.verdict).toBe('unknown');
  });

  it('aggregates met dimensions to met', () => {
    const result = evaluateContracts(
      [
        contract({
          requirements: [
            requirement({
              rto: parseDuration('1h'),
              evidence: 'observed',
            }),
          ],
        }),
      ],
      input({
        evidenceByService: new Map([[PAYMENT.serviceId, [evidence({ measuredRTO: 45 })]]]),
        proofOfRecovery: new Map([[PAYMENT.serviceId, proof({ hasObservedEvidence: true })]]),
      }),
    );

    expect(result.contractResults[0]?.results[0]?.verdict).toBe('met');
  });

  it('returns one DimensionResult for a single-dimension requirement', () => {
    const result = evaluateContracts(
      [contract({ requirements: [requirement({ evidence: 'observed' })] })],
      input({ proofOfRecovery: new Map([[PAYMENT.serviceId, proof({ hasObservedEvidence: true })]]) }),
    );

    expect(result.contractResults[0]?.results[0]?.dimensions).toHaveLength(1);
  });

  it('returns five DimensionResults for a five-dimension requirement', () => {
    const result = evaluateContracts(
      [
        contract({
          requirements: [
            requirement({
              rto: parseDuration('1h'),
              rpo: parseDuration('5m'),
              evidence: 'tested',
              chainCoverage: 'proven',
              spof: 'none',
            }),
          ],
        }),
      ],
      input({
        evidenceByService: new Map([[PAYMENT.serviceId, [evidence({ measuredRTO: 45, measuredRPO: 4 })]]]),
        proofOfRecovery: new Map([[PAYMENT.serviceId, proof({ hasTestedEvidence: true })]]),
        spofsByService: new Map([[PAYMENT.serviceId, []]]),
      }),
    );

    expect(result.contractResults[0]?.results[0]?.dimensions).toHaveLength(5);
    expect(result.contractResults[0]?.results[0]?.verdict).toBe('met');
  });
});

describe('ContractEvaluator enforcement', () => {
  it('does not treat warn violations as enforceable but does treat enforce and hook violations as enforceable', () => {
    const warnContract = contract({
      service: 'payment-processing',
      enforcement: 'warn',
      requirements: [requirement({ rto: parseDuration('1h') })],
    });
    const enforceContract = contract({
      service: 'payment-processing',
      enforcement: 'enforce',
      requirements: [requirement({ rto: parseDuration('1h') })],
    });
    const hookContract = contract({
      service: 'payment-processing',
      enforcement: 'hook',
      hook: {
        type: 'webhook',
        url: 'https://example.com/hook',
        on: ['violated'],
      },
      requirements: [requirement({ rto: parseDuration('1h') })],
    });

    const result = evaluateContracts(
      [warnContract, enforceContract, hookContract],
      input({ evidenceByService: new Map([[PAYMENT.serviceId, [evidence({ measuredRTO: 90 })]]]) }),
    );

    expect(result.hasEnforceableViolations).toBe(true);
    expect(result.enforceableViolations).toHaveLength(2);
  });
});

describe('ContractEvaluator ADR examples', () => {
  it('evaluates ADR example 1 - minimal wildcard', () => {
    const result = evaluateContracts(
      loadContractsFromYaml(ADR_EXAMPLE_1),
      input({
        services: [PAYMENT, AUTH],
        scenarioCoverage: new Map([['az_failure', [coverage(PAYMENT), coverage(AUTH)]]]),
        proofOfRecovery: new Map([
          [PAYMENT.serviceId, proof({ hasObservedEvidence: true })],
          [AUTH.serviceId, proof({ totalRuleCount: 1 })],
        ]),
      }),
    );

    expect(result.globalSummary.total).toBe(2);
    expect(result.globalSummary.met).toBe(1);
    expect(result.globalSummary.violated).toBe(1);
    expect(result.hasEnforceableViolations).toBe(false);
  });

  it('evaluates ADR example 2 - fintech compliance', () => {
    const result = evaluateContracts(
      loadContractsFromYaml(ADR_EXAMPLE_2),
      input({
        scenarioCoverage: new Map([
          ['region_failure', [coverage(PAYMENT)]],
          ['data_corruption', [coverage(PAYMENT)]],
        ]),
        evidenceByService: new Map([
          [
            PAYMENT.serviceId,
            [
              evidence({
                scenario: 'region_failure',
                measuredRTO: 45,
                measuredRPO: 4,
              }),
              evidence({
                id: 'data-corruption-rpo',
                scenario: 'data_corruption',
                measuredRPO: 2,
                testedAt: '2026-02-01T00:00:00.000Z',
              }),
            ],
          ],
        ]),
        proofOfRecovery: new Map([[PAYMENT.serviceId, proof({ hasTestedEvidence: true })]]),
        spofsByService: new Map([[PAYMENT.serviceId, []]]),
      }),
    );

    expect(result.globalSummary.total).toBe(2);
    expect(result.globalSummary.met).toBe(1);
    expect(result.globalSummary.violated).toBe(1);
    expect(result.hasEnforceableViolations).toBe(true);
  });
});

function input(overrides: Partial<ContractEvaluationInput> = {}): ContractEvaluationInput {
  return {
    services: [PAYMENT],
    evidenceByService: new Map([[PAYMENT.serviceId, [evidence()]]]),
    scenarioCoverage: new Map([['region_failure', [coverage(PAYMENT)]]]),
    proofOfRecovery: new Map([[PAYMENT.serviceId, proof({ hasTestedEvidence: true })]]),
    spofsByService: new Map([[PAYMENT.serviceId, []]]),
    ...overrides,
  };
}

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    service: 'payment-processing',
    description: null,
    owner: null,
    enforcement: 'warn',
    hook: null,
    requirements: [requirement({ evidence: 'observed' })],
    ...overrides,
  };
}

function requirement(overrides: Partial<ContractRequirement> = {}): ContractRequirement {
  return {
    scenario: 'region-failure',
    rto: null,
    rpo: null,
    evidence: null,
    chainCoverage: null,
    spof: null,
    ...overrides,
  };
}

function coverage(
  service: ServiceInfo,
  verdict: CoverageDetailInfo['verdict'] = 'covered',
): CoverageDetailInfo {
  return {
    serviceId: service.serviceId,
    verdict,
    evidenceLevel: 'tested',
    missingCapabilities: [],
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

function evidence(overrides: Partial<EvidenceRecordInfo> = {}): EvidenceRecordInfo {
  return {
    id: 'evidence-1',
    serviceId: PAYMENT.serviceId,
    type: 'tested',
    scenario: 'region_failure',
    measuredRTO: 45,
    measuredRPO: 4,
    testedAt: '2026-01-01T00:00:00.000Z',
    testedBy: 'sre',
    confidence: 'high',
    expired: false,
    ...overrides,
  };
}

function loadContractsFromYaml(yaml: string): readonly Contract[] {
  const result = parseContractsYaml(yaml);
  expect(result.status).toBe('loaded');

  if (result.status !== 'loaded') {
    return [];
  }

  return result.config.contracts;
}

const ADR_EXAMPLE_1 = `
version: "1"
contracts:
  - service: "*"
    description: "All services must have at least observed evidence"
    enforcement: warn
    requirements:
      - scenario: "*"
        evidence: observed
`;

const ADR_EXAMPLE_2 = `
version: "1"
contracts:
  - service: payment-processing
    description: "PCI-DSS requires proven recovery within 1h"
    owner: platform-team
    enforcement: enforce
    requirements:
      - scenario: region-failure
        rto: 1h
        rpo: 5m
        evidence: tested
        chain_coverage: proven
        spof: none
      - scenario: data-corruption
        rpo: 1m
        evidence: tested
`;
