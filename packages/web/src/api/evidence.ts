import type { ApiAddEvidenceInput, ApiEvidenceListResponse, Evidence } from '@stronghold-dr/core';

import { apiGet, apiPost } from './client';

export async function listEvidence(filters: {
  readonly nodeId?: string;
  readonly serviceId?: string;
} = {}): Promise<ApiEvidenceListResponse> {
  const params = new URLSearchParams();
  if (filters.nodeId) {
    params.set('nodeId', filters.nodeId);
  }
  if (filters.serviceId) {
    params.set('serviceId', filters.serviceId);
  }
  const query = params.toString();

  return apiGet<ApiEvidenceListResponse>(`/api/evidence${query ? `?${query}` : ''}`);
}

export async function listExpiringEvidence(): Promise<ApiEvidenceListResponse> {
  return apiGet<ApiEvidenceListResponse>('/api/evidence/expiring');
}

export async function addEvidence(input: ApiAddEvidenceInput): Promise<Evidence> {
  return apiPost<Evidence>('/api/evidence', input);
}
