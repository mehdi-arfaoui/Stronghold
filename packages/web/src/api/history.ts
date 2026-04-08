import type {
  ApiHistoryResponse,
  ApiHistoryTrendResponse,
  ApiServiceHistoryResponse,
} from '@stronghold-dr/core';

import { apiGet } from './client';

function buildHistoryQuery(limit?: number): string {
  const params = new URLSearchParams();
  if (typeof limit === 'number') {
    params.set('limit', String(limit));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function listHistory(limit = 20): Promise<ApiHistoryResponse> {
  return apiGet<ApiHistoryResponse>(`/api/history${buildHistoryQuery(limit)}`);
}

export async function getHistoryTrend(limit = 20): Promise<ApiHistoryTrendResponse> {
  return apiGet<ApiHistoryTrendResponse>(`/api/history/trend${buildHistoryQuery(limit)}`);
}

export async function getServiceHistory(
  serviceId: string,
  limit = 10,
): Promise<ApiServiceHistoryResponse> {
  return apiGet<ApiServiceHistoryResponse>(
    `/api/history/service/${encodeURIComponent(serviceId)}${buildHistoryQuery(limit)}`,
  );
}
