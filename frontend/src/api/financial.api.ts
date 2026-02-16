import { api } from './client';

export interface FinancialROIResult {
  currentALE: number;
  projectedALE: number;
  riskReduction: number;
  riskReductionAmount: number;
  annualRemediationCost: number;
  netAnnualSavings: number;
  roiPercent: number;
  paybackMonths: number;
  strongholdSubscriptionAnnual: number;
  breakdownByRecommendation: Array<{
    recommendationId: string;
    strategy: string;
    targetNodes: string[];
    annualCost: number;
    riskReduction: number;
    individualROI: number;
  }>;
  methodology: string;
  sources: string[];
  disclaimer: string;
  currency: string;
  calculatedAt: string;
  cached?: boolean;
}

export interface NodeFinancialImpactResponse {
  node: {
    id: string;
    name: string;
    type: string;
    provider: string;
  };
  impact: {
    estimatedCostPerHour: number;
    confidence: 'user_defined' | 'estimated' | 'low_confidence';
    breakdown: {
      currency: string;
      finalCost: number;
    };
    sources: string[];
  };
  disclaimer: string;
}

export interface DriftFinancialImpactResponse {
  driftId: string;
  financialImpact: {
    additionalAnnualRisk: number;
    rtoDelta: number;
    rpoDelta: number;
    explanation: string;
  };
  severity: 'critical' | 'high' | 'medium' | 'low';
  source: string;
}

export interface OrganizationFinancialProfile {
  tenantId?: string;
  sizeCategory?: string;
  verticalSector?: string | null;
  employeeCount?: number | null;
  annualRevenueUSD?: number | null;
  customDowntimeCostPerHour?: number | null;
  customCurrency?: string;
  strongholdPlanId?: string | null;
  strongholdMonthlyCost?: number | null;
  isConfigured?: boolean;
}

export interface FinancialSummary {
  metrics: {
    annualRisk: number;
    potentialSavings: number;
    roiPercent: number;
    paybackMonths: number;
  };
  totals: {
    totalSPOFs: number;
    avgDowntimeHoursPerIncident: number;
  };
  topSPOFs: Array<{
    nodeId: string;
    nodeName: string;
    nodeType: string;
    ale: number;
    probability: number;
    estimatedDowntimeHours: number;
    costPerHour: number;
    dependentsCount: number;
  }>;
  ale: {
    totalALE: number;
    sources: string[];
    disclaimer: string;
    currency: string;
  };
  roi: {
    currentALE: number;
    projectedALE: number;
    annualRemediationCost: number;
    riskReduction: number;
    riskReductionAmount: number;
    netAnnualSavings?: number;
    roiPercent: number;
    paybackMonths: number;
    breakdownByRecommendation?: Array<{
      recommendationId: string;
      strategy: string;
      targetNodes: string[];
      annualCost: number;
      riskReduction: number;
      individualROI: number;
    }>;
    sources: string[];
    disclaimer: string;
  };
  organizationProfile?: {
    sizeCategory?: string;
    verticalSector?: string;
    customCurrency?: string;
  };
  organization?: {
    id: string;
    name: string;
  };
  regulatoryExposure?: {
    profileSector?: string | null;
    coverageScore?: number;
    moduleSignals?: {
      discoveryCompleted: boolean;
      biaCompleted: boolean;
      simulationExecutedLast30Days: boolean;
      activeRunbookAvailable: boolean;
      praExerciseExecutedLast90Days: boolean;
      completedControls: number;
      totalControls: number;
      coverageScore: number;
    };
    nis2: {
      applicable: boolean;
      entityType?: 'essential_entities' | 'important_entities';
      maxFine?: string;
      complianceDeadline?: string;
      coverageScore?: number;
      benchmark?: unknown;
      source?: string;
    };
    dora: {
      applicable: boolean;
      maxFine?: string;
      complianceDeadline?: string;
      coverageScore?: number;
      benchmark?: unknown;
      source?: string;
    };
    gdpr: { applicable: boolean; benchmark?: unknown };
    applicableRegulations?: Array<{
      id: 'nis2' | 'dora';
      label: string;
      maxFine: string;
      complianceDeadline: string;
      coverageScore: number;
      source: string;
    }>;
  };
  disclaimer: string;
  sources: string[];
  currency: string;
  generatedAt: string;
  cached?: boolean;
}

export interface FinancialTrendPoint {
  analysisId: string;
  scanDate: string;
  resilienceScore: number;
  ale: number;
  spofCount: number;
  criticalDriftCount: number;
  criticalDriftAdditionalRisk: number;
  annotations: Array<{
    driftId: string;
    occurredAt: string;
    label: string;
    additionalAnnualRisk: number;
    nodeName: string | null;
  }>;
}

export interface FinancialTrendResponse {
  lookbackMonths: number;
  currency: string;
  points: FinancialTrendPoint[];
  hasEnoughHistory: boolean;
  message?: string;
  sources: string[];
  disclaimer: string;
  generatedAt: string;
  cached?: boolean;
}

export const financialApi = {
  getSummary: (params?: { currency?: string }) =>
    api.get<FinancialSummary>('/financial/summary', { params }),

  getTrend: (params?: { currency?: string; months?: number }) =>
    api.get<FinancialTrendResponse>('/financial/trend', { params }),

  getBenchmarks: () =>
    api.get('/financial/benchmarks'),

  getOrgProfile: () =>
    api.get<OrganizationFinancialProfile>('/financial/org-profile'),

  updateOrgProfile: (payload: Record<string, unknown>) =>
    api.put('/financial/org-profile', payload),

  calculateALE: (payload?: Record<string, unknown>) =>
    api.post('/financial/calculate-ale', payload ?? {}),

  calculateROI: (payload?: Record<string, unknown>) =>
    api.post<FinancialROIResult>('/financial/calculate-roi', payload ?? {}),

  getNodeImpact: (nodeId: string) =>
    api.get<NodeFinancialImpactResponse>(`/financial/node/${nodeId}/impact`),

  upsertNodeOverride: (
    nodeId: string,
    payload: { customCostPerHour: number; justification?: string; validatedBy?: string },
  ) => api.put(`/financial/node/${nodeId}/override`, payload),

  getDriftImpact: (
    driftId: string,
    payload?: Record<string, unknown>,
  ) => api.post<DriftFinancialImpactResponse>(`/financial/drift/${driftId}/impact`, payload ?? {}),
};
