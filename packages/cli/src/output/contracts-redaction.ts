import type {
  AllContractsEvaluationResult,
  ContractEvaluationResult,
  DimensionResult,
  RequirementEvaluationResult,
} from '@stronghold-dr/core';

export function redactContractEvaluation(
  evaluation: AllContractsEvaluationResult,
): AllContractsEvaluationResult {
  return {
    ...evaluation,
    contractResults: evaluation.contractResults.map(redactContractResult),
    enforceableViolations: evaluation.enforceableViolations.map(redactRequirementResult),
  };
}

export function redactContractReason(value: string): string {
  return value
    .replace(/arn:[^\s,)]+/giu, '[redacted-resource]')
    .replace(/\b\d{12}\b/gu, '[redacted-account]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, '[redacted-ip]');
}

function redactContractResult(
  contractResult: ContractEvaluationResult,
): ContractEvaluationResult {
  return {
    ...contractResult,
    results: contractResult.results.map(redactRequirementResult),
  };
}

function redactRequirementResult(
  result: RequirementEvaluationResult,
): RequirementEvaluationResult {
  return {
    ...result,
    summary: redactContractReason(result.summary),
    dimensions: result.dimensions.map(redactDimensionResult),
  };
}

function redactDimensionResult(dimension: DimensionResult): DimensionResult {
  return {
    ...dimension,
    reason: redactContractReason(dimension.reason),
  };
}
