import type {
  ApiScenarioDetailResponse,
  ApiScenariosResponse,
} from '@stronghold-dr/core';

import { apiGet } from './client';

export async function listScenarios(): Promise<ApiScenariosResponse> {
  return apiGet<ApiScenariosResponse>('/api/scenarios');
}

export async function getScenarioDetail(id: string): Promise<ApiScenarioDetailResponse> {
  return apiGet<ApiScenarioDetailResponse>(`/api/scenarios/${id}`);
}
