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
  demoProfile?: {
    sector: DemoSectorKey;
    sectorLabel: string;
    companySize: DemoCompanySizeKey;
    companySizeLabel: string;
    hasUserOverrides: boolean;
    annualRevenue: number;
    employeeCount: number;
    annualITBudget: number;
    drBudgetPercent: number;
    hourlyDowntimeCost: number;
  };
}

export type DemoSectorKey =
  | 'ecommerce'
  | 'finance'
  | 'healthcare'
  | 'manufacturing'
  | 'it_saas'
  | 'transport'
  | 'energy'
  | 'public';

export type DemoCompanySizeKey = 'pme' | 'pme_plus' | 'eti' | 'large';

export type DemoSeedPayload = {
  sector: DemoSectorKey;
  companySize: DemoCompanySizeKey;
  financialOverrides?: Partial<{
    annualRevenue: number;
    employeeCount: number;
    annualITBudget: number;
    drBudgetPercent: number;
    hourlyDowntimeCost: number;
  }>;
};

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

  seedDemo: (payload?: DemoSeedPayload) =>
    api.post<DemoOnboardingResponse>(
      '/discovery-resilience/seed-demo',
      payload ?? {}
    ),
};
