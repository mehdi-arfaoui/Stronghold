import { api } from './client';

export interface Recommendation {
  id: string;
  nodeId?: string;
  serviceName?: string;
  tier?: number;
  strategy?: 'active-active' | 'warm-standby' | 'pilot-light' | 'backup';
  estimatedCost?: number;
  roi?: number;
  accepted?: boolean | null;
  status?: 'pending' | 'validated' | 'rejected';
  statusUpdatedAt?: string | null;
  statusHistory?: Array<{
    from: 'pending' | 'validated' | 'rejected';
    to: 'pending' | 'validated' | 'rejected';
    changedAt: string;
    notes: string | null;
  }>;
  notes?: string;
  description: string;
  priority: number | 'P0' | 'P1' | 'P2' | 'P3';
  title?: string;
  action?: string;
  category?: 'spof' | 'backup' | 'redundancy' | 'monitoring' | 'network' | 'process' | 'compliance';
  affectedNodeIds?: string[];
  source?: 'rule' | 'normative' | 'ai';
  confidence?: 'high' | 'medium' | 'low';
  normativeReference?: string;
  effort?: 'low' | 'medium' | 'high';
}

export interface RecommendationsSummary {
  totalCost: number;
  byStrategy: Record<string, number>;
  totalRecommendations: number;
}

export const recommendationsApi = {
  getAll: () =>
    api.get<Recommendation[]>('/recommendations/landing-zone'),

  getHybrid: () =>
    api.get<{ recommendations: Recommendation[] }>('/recommendations/hybrid'),

  getSummary: () =>
    api.get<RecommendationsSummary>('/recommendations/landing-zone/cost-summary'),

  updateStatus: (
    id: string,
    data: { status?: 'pending' | 'validated' | 'rejected'; accepted?: boolean | null; notes?: string | null },
  ) =>
    api.patch('/recommendations/landing-zone', { overrides: [{ serviceId: id, ...data }] }),

  resetStatus: (id: string) =>
    api.patch('/recommendations/landing-zone', { overrides: [{ serviceId: id, status: 'pending', notes: null }] }),
};
