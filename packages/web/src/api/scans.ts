import type {
  ApiCreateScanResponse,
  ApiListScansResult,
  ApiScanData,
  ApiScanSummary,
} from '@stronghold-dr/core';

import { apiGet, apiPost } from './client';

function buildScansQuery(limit?: number, cursor?: string): string {
  const params = new URLSearchParams();
  if (typeof limit === 'number') {
    params.set('limit', String(limit));
  }
  if (cursor) {
    params.set('cursor', cursor);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function listScans(options: {
  readonly limit?: number;
  readonly cursor?: string;
} = {}): Promise<ApiListScansResult> {
  const query = buildScansQuery(options.limit, options.cursor);
  return apiGet<ApiListScansResult>(`/api/scans${query}`);
}

export async function getLatestScan(): Promise<ApiScanSummary | null> {
  const result = await listScans({ limit: 20 });
  return result.scans.find((scan) => scan.status === 'COMPLETED') ?? result.scans[0] ?? null;
}

export async function getScanSummary(scanId: string): Promise<ApiScanSummary> {
  return apiGet<ApiScanSummary>(`/api/scans/${scanId}`);
}

export async function getScanData(scanId: string): Promise<ApiScanData> {
  return apiGet<ApiScanData>(`/api/scans/${scanId}/data`);
}

export async function createScan(input: {
  readonly provider: 'aws';
  readonly regions: readonly string[];
  readonly services?: readonly string[];
}): Promise<ApiCreateScanResponse> {
  return apiPost<ApiCreateScanResponse>('/api/scans', input);
}
