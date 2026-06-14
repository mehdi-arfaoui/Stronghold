import {
  type Contract,
  type ContractRequirement,
  type ContractVerdict,
} from './contract-types.js';
import { matchesServicePattern } from './service-matcher.js';
import type {
  AllContractsEvaluationResult,
  ContractEvaluationInput,
  ContractEvaluationResult,
  ContractSummary,
  CoverageDetailInfo,
  DimensionResult,
  RequirementEvaluationResult,
  ServiceInfo,
} from './contract-result-types.js';
import { evaluateChainCoverageRequirement } from './evaluators/chain-coverage-evaluator.js';
import { evaluateEvidenceRequirement } from './evaluators/evidence-evaluator.js';
import { evaluateRpo, evaluateRto } from './evaluators/rto-rpo-evaluator.js';
import { evaluateSpofRequirement } from './evaluators/spof-evaluator.js';
import { normalizeScenarioName } from './evaluators/types.js';

const BUILT_IN_SCENARIOS = new Set([
  'az_failure',
  'region_failure',
  'data_corruption',
  'spof_failure',
]);

const VERDICT_PRIORITY: Record<ContractVerdict, number> = {
  met: 0,
  unknown: 1,
  violated: 2,
  not_applicable: 3,
};

interface ScenarioRequirementEvaluation {
  readonly scenario: string;
  readonly result: RequirementEvaluationResult;
}

interface DimensionSpec {
  readonly dimension: DimensionResult['dimension'];
  readonly required: string;
}

export class ContractEvaluator {
  public evaluate(
    contracts: readonly Contract[],
    input: ContractEvaluationInput,
  ): AllContractsEvaluationResult {
    const contractResults = contracts.map((contract) =>
      evaluateContract(contract, input),
    );
    const globalSummary = summarizeContractSummaries(
      contractResults.map((result) => result.summary),
    );
    const enforceableViolations = collectEnforceableViolations(contractResults);

    return {
      contractResults,
      globalSummary,
      hasEnforceableViolations: enforceableViolations.length > 0,
      enforceableViolations,
    };
  }
}

export function evaluateContracts(
  contracts: readonly Contract[],
  input: ContractEvaluationInput,
): AllContractsEvaluationResult {
  return new ContractEvaluator().evaluate(contracts, input);
}

function evaluateContract(
  contract: Contract,
  input: ContractEvaluationInput,
): ContractEvaluationResult {
  const matchedServices = input.services
    .filter((service) => matchesServicePattern(service.serviceName, contract.service))
    .sort(compareServices);

  if (matchedServices.length === 0) {
    const results = contract.requirements.map((requirement) =>
      createNotApplicableResult(contract, requirement),
    );

    return {
      contract,
      matchedServices: [],
      results,
      summary: summarizeRequirementResults(results),
    };
  }

  const results = matchedServices.flatMap((service) =>
    contract.requirements.map((requirement) =>
      evaluateRequirement(contract, requirement, service, input),
    ),
  );

  return {
    contract,
    matchedServices: matchedServices.map((service) => service.serviceName),
    results,
    summary: summarizeRequirementResults(results),
  };
}

function evaluateRequirement(
  contract: Contract,
  requirement: ContractRequirement,
  service: ServiceInfo,
  input: ContractEvaluationInput,
): RequirementEvaluationResult {
  if (requirement.scenario === '*') {
    return evaluateWildcardScenarioRequirement(contract, requirement, service, input);
  }

  const scenarioKey = resolveScenarioKey(requirement.scenario, input.scenarioCoverage);
  if (!scenarioKey) {
    const reason = isRecognizedScenario(requirement.scenario, input.scenarioCoverage)
      ? `Scenario ${requirement.scenario} was not analyzed by the scan.`
      : `Scenario ${requirement.scenario} is not recognized.`;
    return createUnknownRequirementResult(requirement, service, reason);
  }

  return evaluateRequirementForScenario(requirement, service, scenarioKey, input);
}

function evaluateWildcardScenarioRequirement(
  _contract: Contract,
  requirement: ContractRequirement,
  service: ServiceInfo,
  input: ContractEvaluationInput,
): RequirementEvaluationResult {
  const scenarios = getAvailableScenarios(input.scenarioCoverage);
  if (scenarios.length === 0) {
    return createUnknownRequirementResult(
      requirement,
      service,
      'No scenarios were analyzed by the scan.',
    );
  }

  const evaluations = scenarios.map((scenario) => ({
    scenario,
    result: evaluateRequirementForScenario(requirement, service, scenario, input),
  }));
  const worst = selectWorstScenarioEvaluation(evaluations);
  const scenarioSummary = evaluations
    .map((evaluation) => `${evaluation.scenario}: ${evaluation.result.verdict}`)
    .join(', ');

  return {
    ...worst.result,
    summary: `Worst scenario ${worst.scenario} is ${worst.result.verdict}. Scenario verdicts: ${scenarioSummary}.`,
  };
}

function evaluateRequirementForScenario(
  requirement: ContractRequirement,
  service: ServiceInfo,
  scenario: string,
  input: ContractEvaluationInput,
): RequirementEvaluationResult {
  const proof = input.proofOfRecovery.get(service.serviceId) ?? null;
  const evidence = input.evidenceByService.get(service.serviceId) ?? null;
  const spofs = getMapValueOrNull(input.spofsByService, service.serviceId);
  const coverage = getServiceCoverageDetail(input.scenarioCoverage, scenario, service.serviceId);
  const dimensions: DimensionResult[] = [];

  if (requirement.rto !== null) {
    dimensions.push(
      evaluateRto({
        required: requirement.rto,
        service,
        scenario,
        evidence,
      }),
    );
  }

  if (requirement.rpo !== null) {
    dimensions.push(
      evaluateRpo({
        required: requirement.rpo,
        service,
        scenario,
        evidence,
      }),
    );
  }

  if (requirement.evidence !== null) {
    dimensions.push(evaluateEvidenceRequirement(requirement.evidence, proof, service));
  }

  if (requirement.chainCoverage !== null) {
    dimensions.push(
      evaluateChainCoverageRequirement(requirement.chainCoverage, coverage, proof, service),
    );
  }

  if (requirement.spof !== null) {
    dimensions.push(evaluateSpofRequirement(requirement.spof, spofs, service));
  }

  const verdict = aggregateDimensionVerdicts(dimensions);

  return {
    requirement,
    serviceId: service.serviceId,
    serviceName: service.serviceName,
    verdict,
    dimensions,
    summary: summarizeRequirement(service, scenario, verdict, dimensions),
  };
}

function getServiceCoverageDetail(
  scenarioCoverage: ReadonlyMap<string, readonly CoverageDetailInfo[]>,
  scenario: string,
  serviceId: string,
): CoverageDetailInfo | null {
  const coverage = scenarioCoverage.get(scenario);
  if (!coverage) {
    return null;
  }

  return coverage.find((detail) => detail.serviceId === serviceId) ?? null;
}

function createNotApplicableResult(
  contract: Contract,
  requirement: ContractRequirement,
): RequirementEvaluationResult {
  return {
    requirement,
    serviceId: contract.service,
    serviceName: contract.service,
    verdict: 'not_applicable',
    dimensions: [],
    summary: `No services matched contract service pattern ${contract.service}.`,
  };
}

function createUnknownRequirementResult(
  requirement: ContractRequirement,
  service: ServiceInfo,
  reason: string,
): RequirementEvaluationResult {
  const dimensions = getSpecifiedDimensions(requirement).map((dimension) => ({
    dimension: dimension.dimension,
    verdict: 'unknown' as const,
    required: dimension.required,
    actual: null,
    source: 'not_available' as const,
    reason,
  }));

  return {
    requirement,
    serviceId: service.serviceId,
    serviceName: service.serviceName,
    verdict: 'unknown',
    dimensions,
    summary: reason,
  };
}

function getSpecifiedDimensions(requirement: ContractRequirement): readonly DimensionSpec[] {
  const dimensions: DimensionSpec[] = [];

  if (requirement.rto !== null) {
    dimensions.push({ dimension: 'rto', required: `<= ${requirement.rto.raw}` });
  }
  if (requirement.rpo !== null) {
    dimensions.push({ dimension: 'rpo', required: `<= ${requirement.rpo.raw}` });
  }
  if (requirement.evidence !== null) {
    dimensions.push({ dimension: 'evidence', required: requirement.evidence });
  }
  if (requirement.chainCoverage !== null) {
    dimensions.push({
      dimension: 'chain_coverage',
      required: requirement.chainCoverage,
    });
  }
  if (requirement.spof !== null) {
    dimensions.push({ dimension: 'spof', required: requirement.spof });
  }

  return dimensions;
}

function aggregateDimensionVerdicts(
  dimensions: readonly DimensionResult[],
): ContractVerdict {
  if (dimensions.some((dimension) => dimension.verdict === 'violated')) {
    return 'violated';
  }
  if (dimensions.some((dimension) => dimension.verdict === 'unknown')) {
    return 'unknown';
  }
  return 'met';
}

function summarizeRequirement(
  service: ServiceInfo,
  scenario: string,
  verdict: ContractVerdict,
  dimensions: readonly DimensionResult[],
): string {
  if (dimensions.length === 0) {
    return `No dimensions were specified for ${service.serviceName} in scenario ${scenario}; requirement is met by default.`;
  }

  const details = dimensions
    .map((dimension) => `${dimension.dimension}=${dimension.verdict}`)
    .join(', ');
  return `${service.serviceName} scenario ${scenario} is ${verdict}: ${details}.`;
}

function summarizeRequirementResults(
  results: readonly RequirementEvaluationResult[],
): ContractSummary {
  return {
    met: results.filter((result) => result.verdict === 'met').length,
    violated: results.filter((result) => result.verdict === 'violated').length,
    unknown: results.filter((result) => result.verdict === 'unknown').length,
    notApplicable: results.filter((result) => result.verdict === 'not_applicable').length,
    total: results.length,
  };
}

function summarizeContractSummaries(
  summaries: readonly ContractSummary[],
): ContractSummary {
  return summaries.reduce<ContractSummary>(
    (accumulator, summary) => ({
      met: accumulator.met + summary.met,
      violated: accumulator.violated + summary.violated,
      unknown: accumulator.unknown + summary.unknown,
      notApplicable: accumulator.notApplicable + summary.notApplicable,
      total: accumulator.total + summary.total,
    }),
    {
      met: 0,
      violated: 0,
      unknown: 0,
      notApplicable: 0,
      total: 0,
    },
  );
}

function collectEnforceableViolations(
  contractResults: readonly ContractEvaluationResult[],
): readonly RequirementEvaluationResult[] {
  return contractResults.flatMap((contractResult) => {
    if (
      contractResult.contract.enforcement !== 'enforce' &&
      contractResult.contract.enforcement !== 'hook'
    ) {
      return [];
    }

    return contractResult.results.filter((result) => result.verdict === 'violated');
  });
}

function resolveScenarioKey(
  scenario: string,
  scenarioCoverage: ReadonlyMap<string, readonly CoverageDetailInfo[]>,
): string | null {
  const normalizedScenario = normalizeScenarioName(scenario);
  for (const scenarioKey of scenarioCoverage.keys()) {
    if (normalizeScenarioName(scenarioKey) === normalizedScenario) {
      return scenarioKey;
    }
  }

  return null;
}

function isRecognizedScenario(
  scenario: string,
  scenarioCoverage: ReadonlyMap<string, readonly CoverageDetailInfo[]>,
): boolean {
  const normalizedScenario = normalizeScenarioName(scenario);
  if (BUILT_IN_SCENARIOS.has(normalizedScenario)) {
    return true;
  }

  return Array.from(scenarioCoverage.keys()).some(
    (scenarioKey) => normalizeScenarioName(scenarioKey) === normalizedScenario,
  );
}

function getAvailableScenarios(
  scenarioCoverage: ReadonlyMap<string, readonly CoverageDetailInfo[]>,
): readonly string[] {
  return Array.from(scenarioCoverage.keys()).sort((left, right) =>
    left.localeCompare(right),
  );
}

function selectWorstScenarioEvaluation(
  evaluations: readonly ScenarioRequirementEvaluation[],
): ScenarioRequirementEvaluation {
  const first = evaluations[0];
  if (!first) {
    throw new Error('Cannot select a worst scenario from an empty list.');
  }

  return evaluations.reduce((worst, current) =>
    VERDICT_PRIORITY[current.result.verdict] > VERDICT_PRIORITY[worst.result.verdict]
      ? current
      : worst,
  );
}

function getMapValueOrNull<K, V>(map: ReadonlyMap<K, V>, key: K): V | null {
  const value = map.get(key);
  return value === undefined ? null : value;
}

function compareServices(left: ServiceInfo, right: ServiceInfo): number {
  const nameComparison = left.serviceName.localeCompare(right.serviceName);
  if (nameComparison !== 0) {
    return nameComparison;
  }

  return left.serviceId.localeCompare(right.serviceId);
}
