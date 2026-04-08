import {
  resolveStrongestEvidenceConfidence,
  resolveStrongestEvidenceType,
  type Evidence,
} from './evidence-types.js';
import {
  calculateScoreBreakdown,
  collectCriticalFailures,
  summarizeEvidenceMaturity,
} from '../validation/validation-engine.js';
import type {
  ValidationReport,
  ValidationReportWithEvidence,
  WeightedValidationResult,
  WeightedValidationResultWithEvidence,
} from '../validation/validation-types.js';

export function mergeEvidenceIntoValidationReport(
  report: ValidationReport,
  additionalEvidence: readonly Evidence[],
): ValidationReportWithEvidence {
  const results = report.results.map((result) => mergeEvidenceIntoResult(result, additionalEvidence));
  const scoreBreakdown = calculateScoreBreakdown(results);

  return {
    ...report,
    results,
    score: scoreBreakdown.overall,
    scoreBreakdown,
    criticalFailures: collectCriticalFailures(results),
    evidenceSummary: summarizeEvidenceMaturity(results),
  };
}

function mergeEvidenceIntoResult(
  result: WeightedValidationResult,
  additionalEvidence: readonly Evidence[],
): WeightedValidationResultWithEvidence {
  const currentEvidence =
    'evidence' in result && Array.isArray(result.evidence) ? result.evidence : [];
  const matchingEvidence = additionalEvidence.filter(
    (evidence) =>
      evidence.subject.nodeId === result.nodeId &&
      (!evidence.subject.ruleId || evidence.subject.ruleId === result.ruleId),
  );
  const mergedEvidence = Array.from(
    new Map(
      [...currentEvidence, ...matchingEvidence].map((evidence) => [evidence.id, evidence] as const),
    ).values(),
  );

  const evidenceType = resolveStrongestEvidenceType(mergedEvidence);
  const evidenceConfidence = resolveStrongestEvidenceConfidence(mergedEvidence);

  return {
    ...result,
    evidence: mergedEvidence,
    weightBreakdown: {
      ...result.weightBreakdown,
      evidenceType,
      evidenceConfidence,
    },
  };
}
