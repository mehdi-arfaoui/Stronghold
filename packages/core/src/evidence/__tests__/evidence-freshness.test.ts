import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EVIDENCE_EXPIRATION_DAYS,
  applyEvidenceFreshness,
  checkFreshness,
} from '../evidence-freshness.js';
import type { Evidence } from '../evidence-types.js';

describe('evidence freshness', () => {
  it('returns fresh for evidence without expiry', () => {
    const freshness = checkFreshness(createEvidence({ type: 'observed' }), new Date('2026-04-08T00:00:00.000Z'));

    expect(freshness.status).toBe('fresh');
    expect(freshness.daysUntilExpiry).toBeNull();
  });

  it('returns expiring_soon when expiry is within 14 days', () => {
    const freshness = checkFreshness(
      createEvidence({ expiresAt: '2026-04-20T00:00:00.000Z' }),
      new Date('2026-04-08T00:00:00.000Z'),
    );

    expect(freshness.status).toBe('expiring_soon');
    expect(freshness.daysUntilExpiry).toBe(12);
  });

  it('returns expired when evidence is past expiresAt', () => {
    const freshness = checkFreshness(
      createEvidence({ expiresAt: '2026-04-01T00:00:00.000Z' }),
      new Date('2026-04-08T00:00:00.000Z'),
    );

    expect(freshness.status).toBe('expired');
    expect(freshness.daysUntilExpiry).toBeLessThan(0);
  });

  it('applies default expiration windows by evidence type', () => {
    const declared = applyEvidenceFreshness(
      createEvidence({
        type: 'declared',
        timestamp: '2026-04-08T00:00:00.000Z',
      }),
      new Date('2026-04-08T00:00:00.000Z'),
    );
    const tested = applyEvidenceFreshness(
      createEvidence({
        type: 'tested',
        timestamp: '2026-04-08T00:00:00.000Z',
      }),
      new Date('2026-04-08T00:00:00.000Z'),
    );

    expect(declared.expiresAt).toBe('2026-10-05T00:00:00.000Z');
    expect(tested.expiresAt).toBe('2026-07-07T00:00:00.000Z');
    expect(DEFAULT_EVIDENCE_EXPIRATION_DAYS.declared).toBe(180);
    expect(DEFAULT_EVIDENCE_EXPIRATION_DAYS.tested).toBe(90);
  });

  it('materializes expired evidence as expired type', () => {
    const evidence = applyEvidenceFreshness(
      createEvidence({
        type: 'tested',
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
      new Date('2026-05-01T00:00:00.000Z'),
    );

    expect(evidence.type).toBe('expired');
  });
});

function createEvidence(
  overrides: Partial<Evidence> = {},
): Evidence {
  return {
    id: 'evidence-1',
    type: 'tested',
    source: {
      origin: 'test',
      testType: 'restore-test',
      testDate: '2026-04-08T00:00:00.000Z',
    },
    subject: {
      nodeId: 'payment-db',
      serviceId: 'payment',
    },
    observation: {
      key: 'restore-test',
      value: 'success',
      expected: 'success',
      description: 'Manual restore-test recorded as success.',
    },
    timestamp: '2026-04-08T00:00:00.000Z',
    testResult: {
      status: 'success',
      executor: 'team-backend',
    },
    ...overrides,
  };
}
