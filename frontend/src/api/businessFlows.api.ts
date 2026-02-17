import { api } from './client';

export type FlowCostConfidence = 'high' | 'medium' | 'low';

export interface FlowCost {
  directCostPerHour: number;
  slaPenaltyPerHour: number;
  indirectCostPerHour: number;
  totalCostPerHour: number;
  peakCostPerHour: number;
  method: string;
  confidence: FlowCostConfidence;
}

export interface BusinessFlowNode {
  id: string;
  businessFlowId: string;
  infraNodeId: string;
  orderIndex: number;
  role: string | null;
  isCritical: boolean;
  hasAlternativePath: boolean;
  alternativeNodeId: string | null;
  infraNode?: {
    id: string;
    name: string;
    type: string;
    provider?: string | null;
    region?: string | null;
    isSPOF?: boolean;
    criticalityScore?: number | null;
  } | null;
}

export interface BusinessFlow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  annualRevenue: number | null;
  transactionsPerHour: number | null;
  revenuePerTransaction: number | null;
  estimatedCostPerHour: number | null;
  calculatedCostPerHour: number | null;
  costCalculationMethod: string | null;
  peakHoursMultiplier: number;
  peakHoursStart: number | null;
  peakHoursEnd: number | null;
  operatingDaysPerWeek: number;
  operatingHoursPerDay: number;
  slaUptimePercent: number | null;
  slaPenaltyPerHour: number | null;
  slaPenaltyFlat: number | null;
  contractualRTO: number | null;
  estimatedCustomerChurnPerHour: number | null;
  customerLifetimeValue: number | null;
  reputationImpactCategory: string | null;
  source: string;
  aiConfidence: number | null;
  validatedByUser: boolean;
  validatedAt: string | null;
  mutualExclusionGroup: string | null;
  precisionBadge?: string;
  computedCost: FlowCost | null;
  flowNodes: BusinessFlowNode[];
  createdAt: string;
  updatedAt: string;
}

export interface FinancialCoverage {
  totalCriticalNodes: number;
  coveredCriticalNodes: number;
  uncoveredCriticalNodes: number;
  coveragePercent: number;
  uncoveredNodeIds: string[];
  totalFlows: number;
  validatedFlows: number;
  unvalidatedFlows: number;
}

export interface FlowSuggestionResponse {
  suggestionsCreated: number;
  suggestions: BusinessFlow[];
}

export interface CloudEnrichmentResponse {
  groupedSuggestions: number;
  createdSuggestions: number;
  updatedSuggestions: number;
  skippedNodes: number;
  suggestions: Array<{
    flowId: string;
    flowName: string;
    tagKey: string;
    tagValue: string;
    nodeCount: number;
    status: 'created' | 'updated';
  }>;
}

export const businessFlowsApi = {
  list: () => api.get<BusinessFlow[]>('/business-flows'),
  getById: (id: string) => api.get<BusinessFlow>(`/business-flows/${id}`),
  create: (payload: Record<string, unknown>) => api.post<BusinessFlow>('/business-flows', payload),
  update: (id: string, payload: Record<string, unknown>) =>
    api.patch<BusinessFlow>(`/business-flows/${id}`, payload),
  remove: (id: string) => api.delete(`/business-flows/${id}`),
  validate: (id: string) => api.post<BusinessFlow>(`/business-flows/${id}/validate`, {}),
  addNodes: (
    id: string,
    payload: {
      nodes: Array<{
        infraNodeId: string;
        orderIndex?: number;
        role?: string;
        isCritical?: boolean;
        hasAlternativePath?: boolean;
        alternativeNodeId?: string | null;
      }>;
    },
  ) => api.post<BusinessFlow>(`/business-flows/${id}/nodes`, payload),
  removeNode: (id: string, nodeId: string) =>
    api.delete<BusinessFlow>(`/business-flows/${id}/nodes/${nodeId}`),
  suggestAI: () => api.post<FlowSuggestionResponse>('/business-flows/ai/suggest', {}),
  enrichFromCloud: () =>
    api.post<CloudEnrichmentResponse>('/business-flows/cloud/enrich', {}),
  getCoverage: () => api.get<FinancialCoverage>('/financial/flows-coverage'),
};
