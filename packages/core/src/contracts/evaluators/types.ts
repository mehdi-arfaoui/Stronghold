import type { ParsedDuration } from '../contract-types.js';
import type {
  DimensionResult,
  ServiceInfo,
} from '../contract-result-types.js';

const MILLISECONDS_PER_MINUTE = 60_000;

export type RtoRpoDimension = 'rto' | 'rpo';

export interface RtoRpoEvaluationRequest {
  readonly dimension: RtoRpoDimension;
  readonly required: ParsedDuration;
  readonly service: ServiceInfo;
  readonly scenario: string;
}

export type DimensionEvaluationResult = DimensionResult;

export function normalizeScenarioName(scenario: string): string {
  return scenario.replace(/-/gu, '_');
}

export function scenarioMatchesEvidence(
  evidenceScenario: string | null,
  scenario: string,
): boolean {
  return (
    evidenceScenario === null ||
    normalizeScenarioName(evidenceScenario) === normalizeScenarioName(scenario)
  );
}

export function measuredMinutesToMilliseconds(minutes: number): number {
  return minutes * MILLISECONDS_PER_MINUTE;
}

export function formatMeasuredMinutes(minutes: number): string {
  return `${minutes}m`;
}

export function dimensionLabel(dimension: RtoRpoDimension): string {
  return dimension.toUpperCase();
}
