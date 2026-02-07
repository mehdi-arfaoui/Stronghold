import { api } from './client';
import type { BIAEntry, BIASummary } from '@/types/bia.types';

export const biaApi = {
  getEntries: () =>
    api.get<BIAEntry[]>('/bia/entries'),

  getSummary: () =>
    api.get<BIASummary>('/bia/summary'),

  updateEntry: (id: string, data: Partial<BIAEntry>) =>
    api.patch<BIAEntry>(`/bia/entries/${id}`, data),

  validateEntry: (id: string) =>
    api.patch<BIAEntry>(`/bia/entries/${id}/validate`),

  validateAll: () =>
    api.post('/bia/validate-all'),

  regenerate: () =>
    api.post('/bia/regenerate'),

  exportCSV: () =>
    api.get('/bia/export/csv', { responseType: 'blob' }),
};
