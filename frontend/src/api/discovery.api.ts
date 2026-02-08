import { api } from './client';
import type { ScanConfig, ScanJob, CredentialTestResult, DiscoverySchedule } from '@/types/discovery.types';
import type { GraphData } from '@/types/graph.types';

export const discoveryApi = {
  launchScan: (config: ScanConfig) =>
    api.post<{ jobId: string }>('/discovery-resilience/auto-scan', config),

  getScanJob: (jobId: string) =>
    api.get<ScanJob>(`/discovery-resilience/scan-jobs/${jobId}`),

  getGraph: (params?: { depth?: number; types?: string[] }) =>
    api.get<GraphData>('/resilience/graph', { params }),

  confirmEdge: (edgeId: string) =>
    api.patch(`/resilience/graph/edges/${edgeId}`, { confirmed: true }),

  rejectEdge: (edgeId: string) =>
    api.patch(`/resilience/graph/edges/${edgeId}`, { confirmed: false }),

  testCredentials: (provider: string, credentials: Record<string, string>) =>
    api.post<CredentialTestResult>('/discovery-resilience/test-credentials', { provider, credentials }),

  getSchedules: () =>
    api.get<DiscoverySchedule[]>('/discovery-resilience/schedules'),

  seedDemo: () =>
    api.post<{ success: boolean; nodes: number; totalEdges: number; message: string }>(
      '/discovery-resilience/seed-demo'
    ),
};
