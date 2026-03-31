import type { ApiDriftEventsResponse, DriftReport } from '@stronghold-dr/core';

import { apiGet, apiPost } from './client';

export async function listDriftEvents(scanId: string): Promise<ApiDriftEventsResponse> {
  return apiGet<ApiDriftEventsResponse>(`/api/scans/${scanId}/drift`);
}

export async function checkDrift(input: {
  readonly currentScanId: string;
  readonly baselineScanId: string;
}): Promise<DriftReport> {
  return apiPost<DriftReport>('/api/drift/check', input);
}
