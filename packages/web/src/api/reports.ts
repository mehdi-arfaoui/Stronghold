import type {
  ApiValidationReportResponse,
  ApiValidationSummary,
  DRCategory,
  ValidationSeverity,
} from '@stronghold-dr/core';

import { apiGet } from './client';

function buildReportQuery(filters: {
  readonly format?: 'json' | 'markdown';
  readonly category?: DRCategory;
  readonly severity?: ValidationSeverity;
}): string {
  const params = new URLSearchParams();
  if (filters.format) {
    params.set('format', filters.format);
  }
  if (filters.category) {
    params.set('category', filters.category);
  }
  if (filters.severity) {
    params.set('severity', filters.severity);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function getValidationReport(scanId: string): Promise<ApiValidationReportResponse> {
  return apiGet<ApiValidationReportResponse>(`/api/scans/${scanId}/report`);
}

export async function getValidationSummary(scanId: string): Promise<ApiValidationSummary> {
  return apiGet<ApiValidationSummary>(`/api/scans/${scanId}/report/summary`);
}

export async function getValidationReportMarkdown(
  scanId: string,
  filters: {
    readonly category?: DRCategory;
    readonly severity?: ValidationSeverity;
  } = {},
): Promise<string> {
  const query = buildReportQuery({ ...filters, format: 'markdown' });
  return apiGet<string>(`/api/scans/${scanId}/report${query}`);
}
