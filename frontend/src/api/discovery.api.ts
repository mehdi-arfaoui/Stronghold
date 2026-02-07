import { api } from './client';
import type { ScanConfig, ScanJob, CredentialTestResult, DiscoverySchedule } from '@/types/discovery.types';
import type { GraphData } from '@/types/graph.types';

export const discoveryApi = {
  launchScan: (config: ScanConfig) =>
    api.post<{ jobId: string }>('/discovery/auto-scan', config),

  getScanJob: (jobId: string) =>
    api.get<ScanJob>(`/discovery/scan-jobs/${jobId}`),

  getGraph: (params?: { depth?: number; types?: string[] }) =>
    api.get<GraphData>('/discovery/graph', { params }),

  confirmEdge: (edgeId: string) =>
    api.patch(`/discovery/edges/${edgeId}`, { confirmed: true }),

  rejectEdge: (edgeId: string) =>
    api.patch(`/discovery/edges/${edgeId}`, { confirmed: false }),

  testCredentials: (provider: string, credentials: Record<string, string>) =>
    api.post<CredentialTestResult>('/discovery/test-credentials', { provider, credentials }),

  getSchedules: () =>
    api.get<DiscoverySchedule[]>('/discovery/schedules'),
};
