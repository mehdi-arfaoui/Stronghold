import { api } from './client';
import type { ResilienceScore, SPOFItem, RedundancyAnalysis, RegionalConcentration } from '@/types/analysis.types';

export const analysisApi = {
  getResilienceScore: () =>
    api.get<ResilienceScore>('/analysis/resilience/score'),

  getSPOFs: () =>
    api.get<SPOFItem[]>('/analysis/resilience/spofs'),

  getRedundancy: () =>
    api.get<RedundancyAnalysis[]>('/analysis/resilience/redundancy-issues'),

  getRegionalConcentration: () =>
    api.get<RegionalConcentration[]>('/analysis/resilience/regional-risks'),

  triggerAnalysis: () =>
    api.post('/analysis/resilience'),
};
