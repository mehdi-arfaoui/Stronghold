import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_CONFIDENCE,
  EVIDENCE_TYPES,
  type Evidence,
  type EvidenceType,
} from '../index.js';

describe('evidence types', () => {
  it('exports every evidence type in the confidence map', () => {
    const confidenceKeys = Object.keys(EVIDENCE_CONFIDENCE).sort();
    const evidenceTypes = [...EVIDENCE_TYPES].sort();

    expect(confidenceKeys).toEqual(evidenceTypes);
  });

  it('covers all evidence types with a numeric confidence weight', () => {
    for (const evidenceType of EVIDENCE_TYPES) {
      const confidence = EVIDENCE_CONFIDENCE[evidenceType];
      expect(typeof confidence).toBe('number');
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it('keeps observed evidence below full test confidence', () => {
    expect(EVIDENCE_CONFIDENCE.observed).toBe(0.85);
    expect(EVIDENCE_CONFIDENCE.tested).toBe(1);
    expect(EVIDENCE_CONFIDENCE.observed).toBeLessThan(EVIDENCE_CONFIDENCE.tested);
  });

  it('allows evidence objects to carry typed maturity and source metadata', () => {
    const evidence: Evidence = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      type: 'tested',
      source: {
        origin: 'test',
        testType: 'restore-test',
        testDate: '2026-04-08T10:00:00.000Z',
      },
      subject: {
        nodeId: 'payment-db',
        serviceId: 'payment',
        ruleId: 'backup_plan_exists',
      },
      observation: {
        key: 'backupRetentionPeriod',
        value: 7,
        expected: '> 0',
        description: 'Automated backups retained for 7 day(s).',
      },
      timestamp: '2026-04-08T10:00:00.000Z',
      expiresAt: '2026-07-07T10:00:00.000Z',
      testResult: {
        status: 'success',
        duration: '12 minutes',
        executor: 'team-backend',
      },
    };

    expect(evidence.type satisfies EvidenceType).toBe('tested');
    expect(evidence.source.origin).toBe('test');
    expect(evidence.testResult?.status).toBe('success');
  });
});
