import { describe, expect, it } from 'vitest';

import { parseDuration } from '../duration-parser.js';
import type { EvidenceRecordInfo, ServiceInfo } from '../contract-result-types.js';
import { evaluateRpo, evaluateRto } from './rto-rpo-evaluator.js';

const SERVICE: ServiceInfo = {
  serviceId: 'svc-payment',
  serviceName: 'payment-processing',
};

describe('evaluateRto', () => {
  it('returns met for tested measured RTO within the required duration', () => {
    const result = evaluateRto({
      required: parseDuration('1h'),
      service: SERVICE,
      scenario: 'region_failure',
      evidence: [createEvidence({ measuredRTO: 45 })],
    });

    expect(result.verdict).toBe('met');
    expect(result.actual).toBe('45m');
    expect(result.source).toBe('measured');
  });

  it('returns violated for tested measured RTO above the required duration', () => {
    const result = evaluateRto({
      required: parseDuration('1h'),
      service: SERVICE,
      scenario: 'region_failure',
      evidence: [createEvidence({ measuredRTO: 90 })],
    });

    expect(result.verdict).toBe('violated');
    expect(result.actual).toBe('90m');
  });

  it('returns met when measured RTO exactly equals the required duration', () => {
    const result = evaluateRto({
      required: parseDuration('1h'),
      service: SERVICE,
      scenario: 'region_failure',
      evidence: [createEvidence({ measuredRTO: 60 })],
    });

    expect(result.verdict).toBe('met');
  });

  it('returns unknown when no evidence exists', () => {
    const result = evaluateRto({
      required: parseDuration('1h'),
      service: SERVICE,
      scenario: 'region_failure',
      evidence: [],
    });

    expect(result.verdict).toBe('unknown');
    expect(result.source).toBe('not_available');
  });

  it('ignores observed evidence', () => {
    const result = evaluateRto({
      required: parseDuration('1h'),
      service: SERVICE,
      scenario: 'region_failure',
      evidence: [createEvidence({ type: 'observed', measuredRTO: 45 })],
    });

    expect(result.verdict).toBe('unknown');
  });

  it('ignores tested evidence without a measured RTO', () => {
    const result = evaluateRto({
      required: parseDuration('1h'),
      service: SERVICE,
      scenario: 'region_failure',
      evidence: [createEvidence({ measuredRTO: null })],
    });

    expect(result.verdict).toBe('unknown');
  });

  it('ignores expired evidence', () => {
    const result = evaluateRto({
      required: parseDuration('1h'),
      service: SERVICE,
      scenario: 'region_failure',
      evidence: [createEvidence({ expired: true, measuredRTO: 45 })],
    });

    expect(result.verdict).toBe('unknown');
  });

  it('uses the most recent matching evidence', () => {
    const result = evaluateRto({
      required: parseDuration('1h'),
      service: SERVICE,
      scenario: 'region_failure',
      evidence: [
        createEvidence({ id: 'old', measuredRTO: 90, testedAt: '2026-01-01T00:00:00.000Z' }),
        createEvidence({ id: 'new', measuredRTO: 45, testedAt: '2026-02-01T00:00:00.000Z' }),
      ],
    });

    expect(result.verdict).toBe('met');
    expect(result.actual).toBe('45m');
  });

  it('filters evidence by scenario', () => {
    const result = evaluateRto({
      required: parseDuration('1h'),
      service: SERVICE,
      scenario: 'az-failure',
      evidence: [
        createEvidence({ id: 'region', scenario: 'region_failure', measuredRTO: 45 }),
        createEvidence({ id: 'az', scenario: 'az_failure', measuredRTO: 90 }),
      ],
    });

    expect(result.verdict).toBe('violated');
    expect(result.actual).toBe('90m');
  });

  it('treats evidence without a scenario as applicable to all scenarios', () => {
    const result = evaluateRto({
      required: parseDuration('1h'),
      service: SERVICE,
      scenario: 'data_corruption',
      evidence: [createEvidence({ scenario: null, measuredRTO: 45 })],
    });

    expect(result.verdict).toBe('met');
  });

  it('includes the evidence add command in unknown reasons', () => {
    const result = evaluateRto({
      required: parseDuration('1h'),
      service: SERVICE,
      scenario: 'region_failure',
      evidence: [],
    });

    expect(result.reason).toContain('stronghold evidence add');
    expect(result.reason).toContain('--service payment-processing');
    expect(result.reason).toContain('--scenario region_failure');
    expect(result.reason).toContain('--type tested');
    expect(result.reason).toContain('--rto <measured_duration> --rpo <measured_duration>');
  });
});

describe('evaluateRpo', () => {
  it('evaluates measured RPO using tested evidence only', () => {
    const result = evaluateRpo({
      required: parseDuration('5m'),
      service: SERVICE,
      scenario: 'data_corruption',
      evidence: [createEvidence({ scenario: 'data_corruption', measuredRPO: 4 })],
    });

    expect(result.verdict).toBe('met');
    expect(result.actual).toBe('4m');
  });
});

function createEvidence(overrides: Partial<EvidenceRecordInfo> = {}): EvidenceRecordInfo {
  return {
    id: 'evidence-1',
    serviceId: SERVICE.serviceId,
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
