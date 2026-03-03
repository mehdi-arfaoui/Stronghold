import { api } from './client';
import type {
  ScanConfig,
  ScanJob,
  CredentialTestResult,
  DiscoverySchedule,
  ScanHealthReport,
  ScanTimelineEntry,
} from '@/types/discovery.types';
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
    api.get<{ schedules: DiscoverySchedule[] }>('/discovery-resilience/schedules'),

  updateSchedule: (payload: {
    enabled: boolean;
    intervalMinutes: number;
    providers: Array<{ type: string; credentials: Record<string, string>; regions?: string[] }>;
    kubernetes?: unknown[];
    onPremise?: { ipRanges: string[] };
    options?: Record<string, unknown>;
  }) =>
    api.post<{ schedule: DiscoverySchedule }>('/discovery-resilience/schedules', payload),

  runScheduledScanNow: () =>
    api.post<{ jobId: string; status: 'queued' }>('/discovery-resilience/schedules/run-now', {}),

  getScanTimeline: (limit = 20) =>
    api.get<{ entries: ScanTimelineEntry[] }>('/discovery-resilience/scan-timeline', {
      params: { limit },
    }),

  getHealth: () =>
    api.get<{ data: ScanHealthReport }>('/discovery/health'),
};
