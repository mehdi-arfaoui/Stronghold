export const EVIDENCE_TYPES = [
  'observed',
  'inferred',
  'declared',
  'tested',
  'expired',
] as const;

/**
 * Evidence maturity taxonomy ordered from weakest to strongest,
 * except `expired`, which represents stale evidence of any origin.
 */
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export type EvidenceSource =
  | {
      readonly origin: 'scan';
      readonly scanId?: string;
      readonly scanTimestamp: string;
    }
  | {
      readonly origin: 'inference';
      readonly method: string;
      readonly confidence: number;
    }
  | {
      readonly origin: 'manual';
      readonly author?: string;
      readonly file?: string;
    }
  | {
      readonly origin: 'test';
      readonly testType: string;
      readonly testDate: string;
    };

export interface EvidenceSubject {
  readonly nodeId: string;
  readonly serviceId?: string;
  readonly ruleId?: string;
}

export interface EvidenceObservation {
  readonly key: string;
  readonly value: unknown;
  readonly expected?: string;
  readonly description: string;
}

export interface EvidenceTestResult {
  readonly status: 'success' | 'failure' | 'partial';
  readonly duration?: string;
  readonly notes?: string;
  readonly executor?: string;
}

/**
 * Evidence is a verifiable proof that supports or contradicts a DR finding.
 * Every finding should be traceable to at least one piece of evidence.
 */
export interface Evidence {
  readonly id: string;
  readonly type: EvidenceType;
  readonly source: EvidenceSource;
  readonly subject: EvidenceSubject;
  readonly observation: EvidenceObservation;
  readonly timestamp: string;
  readonly expiresAt?: string;
  readonly testResult?: EvidenceTestResult;
}

/**
 * Confidence weight associated with each evidence type.
 * Used in scoring to reward tested evidence over mere observation.
 */
export const EVIDENCE_CONFIDENCE: Record<EvidenceType, number> = {
  observed: 0.85,
  inferred: 0.5,
  declared: 0.7,
  tested: 1.0,
  expired: 0.2,
};

export function resolveStrongestEvidenceType(
  evidence: readonly Pick<Evidence, 'type'>[],
): EvidenceType {
  return evidence.reduce<EvidenceType>(
    (strongest, item) =>
      EVIDENCE_CONFIDENCE[item.type] > EVIDENCE_CONFIDENCE[strongest] ? item.type : strongest,
    'observed',
  );
}

export function resolveStrongestEvidenceConfidence(
  evidence: readonly Pick<Evidence, 'type'>[],
): number {
  return EVIDENCE_CONFIDENCE[resolveStrongestEvidenceType(evidence)];
}
