import type { ApiGeneratePlanResult, ApiStoredDrPlan } from '@stronghold-dr/core';

import { APIError, apiGet, apiPost } from './client';

function buildFormatQuery(format: 'yaml' | 'json'): string {
  return `?format=${format}`;
}

export async function getLatestStoredPlan(scanId: string): Promise<ApiStoredDrPlan> {
  return apiGet<ApiStoredDrPlan>(`/api/scans/${scanId}/plan`);
}

export async function generatePlan(scanId: string): Promise<ApiGeneratePlanResult> {
  const result = await apiPost<unknown>(`/api/scans/${scanId}/plan/generate${buildFormatQuery('json')}`);
  if (isGeneratePlanResult(result)) {
    return result;
  }

  throw new APIError(0, 'UNEXPECTED_PAYLOAD', 'Plan API returned an unexpected payload.');
}

export async function exportPlan(scanId: string, format: 'yaml' | 'json'): Promise<string> {
  if (format === 'json') {
    const result = await generatePlan(scanId);
    return JSON.stringify(result.plan, null, 2);
  }

  return apiPost<string>(`/api/scans/${scanId}/plan/generate${buildFormatQuery('yaml')}`);
}

function isGeneratePlanResult(value: unknown): value is ApiGeneratePlanResult {
  if (!isRecord(value)) {
    return false;
  }

  const plan = value.plan;
  const validation = value.validation;
  return (
    isRecord(plan) &&
    Array.isArray(plan.services) &&
    isRecord(validation) &&
    typeof validation.isValid === 'boolean' &&
    value.format === 'json' &&
    typeof value.content === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
