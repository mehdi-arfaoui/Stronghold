import { api } from './client';
import type { BIAEntry, BIASummary } from '@/types/bia.types';

export interface BIAEntriesResponse {
  entries: BIAEntry[];
  tiers: Record<string, { count: number; services: string[]; totalImpact: number }>;
}

export const biaApi = {
  getEntries: () =>
    api.get<BIAEntriesResponse>('/bia-resilience/entries'),

  getSummary: () =>
    api.get<BIASummary>('/bia-resilience/summary'),

  updateEntry: (id: string, data: Partial<BIAEntry>) =>
    api.patch<BIAEntry>(`/bia-resilience/processes/${id}`, data),

  validateEntry: (id: string) =>
    api.patch<BIAEntry>(`/bia-resilience/processes/${id}`, { validationStatus: 'validated' }),

  validateAll: () =>
    api.post('/bia-resilience/validate-all'),

  regenerate: () =>
    api.post('/bia-resilience/auto-generate'),

  exportCSV: () =>
    api.get('/bia-resilience/export/csv', { responseType: 'blob' }),

  exportFormat: (format: string, options?: { columns?: string[]; exportAll?: boolean }) =>
    api.get(`/bia-resilience/export/${format}`, {
      responseType: format === 'json' ? 'json' : 'blob',
      params: options,
    }),
};
