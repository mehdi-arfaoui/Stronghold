import { api } from './client';
import type { ResilienceScore, SPOFItem, RedundancyAnalysis, RegionalConcentration } from '@/types/analysis.types';

export const analysisApi = {
  getResilienceScore: () =>
    api.get<ResilienceScore>('/analysis/resilience-score'),

  getSPOFs: () =>
    api.get<SPOFItem[]>('/analysis/spofs'),

  getRedundancy: () =>
    api.get<RedundancyAnalysis[]>('/analysis/redundancy'),

  getRegionalConcentration: () =>
    api.get<RegionalConcentration[]>('/analysis/regional-concentration'),

  triggerAnalysis: () =>
    api.post('/analysis/run'),
};
