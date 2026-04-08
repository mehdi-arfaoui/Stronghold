export {
  EVIDENCE_CONFIDENCE,
  EVIDENCE_TYPES,
  resolveStrongestEvidenceConfidence,
  resolveStrongestEvidenceType,
  type Evidence,
  type EvidenceObservation,
  type EvidenceSource,
  type EvidenceSubject,
  type EvidenceTestResult,
  type EvidenceType,
} from './evidence-types.js';
export { extractEvidence } from './evidence-extractor.js';
export { mergeEvidenceIntoValidationReport } from './evidence-merger.js';
export {
  applyEvidenceFreshness,
  checkFreshness,
  DEFAULT_EVIDENCE_EXPIRATION_DAYS,
  type FreshnessResult,
} from './evidence-freshness.js';
export { FileEvidenceStore, type EvidenceStore } from './evidence-store.js';
