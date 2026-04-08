import type {
  ApiServiceDetailResponse,
  ApiServicesResponse,
} from '@stronghold-dr/core';

import { apiGet, apiPost } from './client';

export async function listServices(): Promise<ApiServicesResponse> {
  return apiGet<ApiServicesResponse>('/api/services');
}

export async function getServiceDetail(serviceId: string): Promise<ApiServiceDetailResponse> {
  return apiGet<ApiServiceDetailResponse>(`/api/services/${serviceId}`);
}

export async function redetectServices(): Promise<ApiServicesResponse> {
  return apiPost<ApiServicesResponse>('/api/services/detect');
}
