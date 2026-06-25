import type { ParsedDuration } from '../contract-types.js';
import type {
  DimensionResult,
  EvidenceRecordInfo,
  ServiceInfo,
} from '../contract-result-types.js';
import {
  dimensionLabel,
  formatMeasuredMinutes,
  measuredMinutesToMilliseconds,
  scenarioMatchesEvidence,
  type RtoRpoDimension,
} from './types.js';

export interface EvaluateRtoRpoInput {
  readonly dimension: RtoRpoDimension;
  readonly required: ParsedDuration;
  readonly service: ServiceInfo;
  readonly scenario: string;
  readonly evidence: readonly EvidenceRecordInfo[] | null;
}

export function evaluateRto(input: Omit<EvaluateRtoRpoInput, 'dimension'>): DimensionResult {
  return evaluateRtoRpo({
    ...input,
    dimension: 'rto',
  });
}

export function evaluateRpo(input: Omit<EvaluateRtoRpoInput, 'dimension'>): DimensionResult {
  return evaluateRtoRpo({
    ...input,
    dimension: 'rpo',
  });
}

export function evaluateRtoRpo(input: EvaluateRtoRpoInput): DimensionResult {
  const latestEvidence = findLatestMeasuredEvidence(
    input.evidence ?? [],
    input.dimension,
    input.scenario,
  );
  const required = `<= ${input.required.raw}`;
  const label = dimensionLabel(input.dimension);
  const evidenceCommand = formatEvidenceCommand(input.service.serviceName, input.scenario);

  if (!latestEvidence) {
    return {
      dimension: input.dimension,
      verdict: 'unknown',
      required,
      actual: null,
      source: 'not_available',
      reason: `No tested evidence with measured ${label} for service '${input.service.serviceName}' under scenario '${input.scenario}'. Run: ${evidenceCommand}`,
    };
  }

  const measuredMinutes =
    input.dimension === 'rto'
      ? latestEvidence.measuredRTO
      : latestEvidence.measuredRPO;

  if (measuredMinutes === null) {
    return {
      dimension: input.dimension,
      verdict: 'unknown',
      required,
      actual: null,
      source: 'not_available',
      reason: `No tested evidence with measured ${label} for service '${input.service.serviceName}' under scenario '${input.scenario}'. Run: ${evidenceCommand}`,
    };
  }

  const actual = formatMeasuredMinutes(measuredMinutes);
  const measuredMs = measuredMinutesToMilliseconds(measuredMinutes);
  const verdict = measuredMs <= input.required.totalMs ? 'met' : 'violated';
  const comparison = verdict === 'met' ? '≤' : '>';

  return {
    dimension: input.dimension,
    verdict,
    required,
    actual,
    source: 'measured',
    reason: `Tested ${label} ${actual} ${comparison} required ${input.required.raw} for scenario ${input.scenario}.`,
  };
}

function formatEvidenceCommand(serviceName: string, scenario: string): string {
  return `stronghold evidence add --service ${serviceName} --scenario ${scenario} --type tested --rto <measured_duration> --rpo <measured_duration>`;
}

function findLatestMeasuredEvidence(
  evidence: readonly EvidenceRecordInfo[],
  dimension: RtoRpoDimension,
  scenario: string,
): EvidenceRecordInfo | null {
  const measuredField = dimension === 'rto' ? 'measuredRTO' : 'measuredRPO';
  return evidence
    .filter(
      (record) =>
        record.type === 'tested' &&
        !record.expired &&
        record[measuredField] !== null &&
        scenarioMatchesEvidence(record.scenario, scenario),
    )
    .sort((left, right) => right.testedAt.localeCompare(left.testedAt))[0] ?? null;
}
