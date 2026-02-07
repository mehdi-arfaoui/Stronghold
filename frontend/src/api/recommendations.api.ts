import { api } from './client';

export interface Recommendation {
  id: string;
  nodeId: string;
  serviceName: string;
  tier: number;
  strategy: 'active-active' | 'warm-standby' | 'pilot-light' | 'backup';
  estimatedCost: number;
  roi: number;
  accepted: boolean | null;
  notes?: string;
  description: string;
  priority: number;
}

export interface RecommendationsSummary {
  totalCost: number;
  byStrategy: Record<string, number>;
  totalRecommendations: number;
}

export const recommendationsApi = {
  getAll: () =>
    api.get<Recommendation[]>('/recommendations'),

  getSummary: () =>
    api.get<RecommendationsSummary>('/recommendations/summary'),

  updateStatus: (id: string, data: { accepted: boolean; notes?: string }) =>
    api.patch(`/recommendations/${id}`, data),
};
