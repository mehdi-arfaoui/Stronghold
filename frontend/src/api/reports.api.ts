import { api } from './client';

export interface ReportPrerequisite {
  id: string;
  label: string;
  met: boolean;
  details?: string;
}

export interface ReportConfig {
  format: 'pdf' | 'docx';
  includeSimulations: string[];
  includeExercises: string[];
}

export const reportsApi = {
  getPrerequisites: () =>
    api.get<ReportPrerequisite[]>('/reports/prerequisites'),

  generate: (config: ReportConfig) =>
    api.post('/reports/generate', config, { responseType: 'blob' }),

  generateExecutiveFinancialSummary: (payload?: { currency?: string }) =>
    api.post('/reports/executive-financial', payload ?? {}, { responseType: 'blob' }),

  generatePptx: () =>
    api.get('/reports/pptx', { responseType: 'blob' }),

  getPreview: () =>
    api.get<{ html: string }>('/reports/preview'),
};
