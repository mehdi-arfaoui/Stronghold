import { api } from './client';
import type { ScanConfig, ScanJob, CredentialTestResult, DiscoverySchedule, ScanHealthReport } from '@/types/discovery.types';
import type { GraphData } from '@/types/graph.types';

export interface DemoOnboardingPipelineStep {
  step: string;
  status: 'completed' | 'failed';
  durationMs: number;
  details?: string;
}

export interface DemoOnboardingResponse {
  success: boolean;
  message: string;
  environment: string;
  mode: string;
  nodes: number;
  confirmedEdges: number;
  inferredEdges: number;
  totalEdges: number;
  resilienceScore: number;
  spofCount: number;
  biaProcesses: number;
  risksDetected: number;
  organizationProfileConfigured: boolean;
  businessFlows: number;
  validatedBusinessFlows: number;
  unvalidatedBusinessFlows: number;
  flowCoveragePercent: number;
  userOverrides: number;
  spofs: string[];
  servicesSeeded: number;
  incidentsSeeded: number;
  simulationsSeeded: number;
  runbooksSeeded: number;
  praExercisesSeeded: number;
  durationMs: number;
  performanceBudgetMs: number;
  withinPerformanceBudget: boolean;
  pipeline: DemoOnboardingPipelineStep[];
}

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

  getHealth: () =>
    api.get<{ data: ScanHealthReport }>('/discovery/health'),

  seedDemo: () =>
    api.post<DemoOnboardingResponse>(
      '/discovery-resilience/seed-demo'
    ),
};
