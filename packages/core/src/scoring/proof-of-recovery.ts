import { resolveStrongestEvidenceType } from '../evidence/index.js';
import type { ServicePostureService } from '../services/index.js';
import type { ValidationReport, WeightedValidationResult } from '../validation/index.js';
import type {
  CalculateProofOfRecoveryInput,
  ProofOfRecoveryResult,
  ProofOfRecoveryServiceResult,
} from './proof-of-recovery-types.js';

const PASS_STATUS = 'pass';

export function calculateProofOfRecovery(
  input: CalculateProofOfRecoveryInput,
): ProofOfRecoveryResult {
  const services = input.servicePosture?.services ?? [];
  const results = collectValidationResults(input.validationReport);
  const perService = services.map((service) =>
    summarizeServiceProof(service, results),
  );
  const criticalServices = perService.filter((service) => service.criticality === 'critical');

  return {
    proofOfRecovery:
      criticalServices.length === 0
        ? null
        : percentage(
            criticalServices.filter((service) => service.hasTestedEvidence).length,
            criticalServices.length,
          ),
    proofOfRecoveryAll:
      perService.length === 0
        ? null
        : percentage(
            perService.filter((service) => service.hasTestedEvidence).length,
            perService.length,
          ),
    observedCoverage: calculateObservedCoverage(results),
    perService,
  };
}

function summarizeServiceProof(
  service: ServicePostureService,
  results: readonly WeightedValidationResult[],
): ProofOfRecoveryServiceResult {
  const nodeIds = new Set(service.service.resources.map((resource) => resource.nodeId));
  const passingResults = results.filter(
    (result) => nodeIds.has(result.nodeId) && result.status === PASS_STATUS,
  );
  const testedRuleCount = passingResults.filter((result) => resolveProofType(result) === 'tested').length;

  return {
    serviceId: service.service.id,
    serviceName: service.service.name,
    criticality: service.service.criticality,
    hasTestedEvidence: testedRuleCount > 0,
    hasObservedEvidence: passingResults.some((result) => resolveProofType(result) === 'observed'),
    testedRuleCount,
    totalRuleCount: passingResults.length,
  };
}

function calculateObservedCoverage(results: readonly WeightedValidationResult[]): number {
  const passingResults = results.filter((result) => result.status === PASS_STATUS);
  if (passingResults.length === 0) {
    return 0;
  }

  return percentage(
    passingResults.filter((result) => resolveProofType(result) === 'observed').length,
    passingResults.length,
  );
}

function resolveProofType(
  result: WeightedValidationResult,
): ProofOfRecoveryEvidenceType {
  if ('weightBreakdown' in result && 'evidenceType' in result.weightBreakdown) {
    const evidenceType = result.weightBreakdown.evidenceType;
    if (isProofEvidenceType(evidenceType)) {
      return evidenceType;
    }
  }

  if ('evidence' in result && Array.isArray(result.evidence) && result.evidence.length > 0) {
    return toProofEvidenceType(resolveStrongestEvidenceType(result.evidence));
  }

  return 'observed';
}

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 100);
}

function collectValidationResults(
  validationReport: ValidationReport,
): readonly WeightedValidationResult[] {
  return Array.isArray(validationReport.results) ? validationReport.results : [];
}

type ProofOfRecoveryEvidenceType = 'observed' | 'tested' | 'declared' | 'inferred' | 'expired';

function isProofEvidenceType(value: unknown): value is ProofOfRecoveryEvidenceType {
  return (
    value === 'observed' ||
    value === 'tested' ||
    value === 'declared' ||
    value === 'inferred' ||
    value === 'expired'
  );
}

function toProofEvidenceType(value: string): ProofOfRecoveryEvidenceType {
  return isProofEvidenceType(value) ? value : 'observed';
}
