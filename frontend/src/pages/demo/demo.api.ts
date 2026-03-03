import { api } from '@/api/client';
import type { DemoCompanySizeKey, DemoSectorKey } from './demo-profiles';

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

export function seedDemo(payload: DemoSeedPayload) {
  return api.post<DemoOnboardingResponse>('/discovery-resilience/seed-demo', payload);
}
