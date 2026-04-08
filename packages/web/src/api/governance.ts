import type {
  ApiGovernanceAcceptInput,
  ApiGovernanceAcceptResult,
  ApiGovernanceAcceptancesResponse,
  ApiGovernancePoliciesResponse,
  ApiGovernanceResponse,
} from '@stronghold-dr/core';

import { apiGet, apiPost } from './client';

export async function getGovernance(): Promise<ApiGovernanceResponse> {
  return apiGet<ApiGovernanceResponse>('/api/governance');
}

export async function listGovernanceAcceptances(): Promise<ApiGovernanceAcceptancesResponse> {
  return apiGet<ApiGovernanceAcceptancesResponse>('/api/governance/acceptances');
}

export async function listGovernancePolicies(): Promise<ApiGovernancePoliciesResponse> {
  return apiGet<ApiGovernancePoliciesResponse>('/api/governance/policies');
}

export async function acceptGovernanceRisk(
  input: ApiGovernanceAcceptInput,
): Promise<ApiGovernanceAcceptResult> {
  return apiPost<ApiGovernanceAcceptResult>('/api/governance/accept', input);
}
