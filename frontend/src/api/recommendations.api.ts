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
    api.get<Recommendation[]>('/recommendations/landing-zone'),

  getSummary: () =>
    api.get<RecommendationsSummary>('/recommendations/landing-zone/cost-summary'),

  updateStatus: (id: string, data: { accepted: boolean; notes?: string }) =>
    api.patch('/recommendations/landing-zone', { overrides: [{ serviceId: id, ...data }] }),
};
