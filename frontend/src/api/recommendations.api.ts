import { api } from './client';

export interface Recommendation {
  id: string;
  nodeId?: string;
  serviceName?: string;
  serviceDisplayName?: string;
  serviceTechnicalName?: string;
  businessName?: string | null;
  nodeType?: string | null;
  provider?: string | null;
  region?: string | null;
  availabilityZone?: string | null;
  metadata?: Record<string, unknown> | null;
  tier?: number;
  groupKey?: string | null;
  allocationShare?: number;
  recommendationBand?: 'primary' | 'secondary';
  costCountedInSummary?: boolean;
  strategy?:
    | 'backup-restore'
    | 'pilot-light'
    | 'warm-standby'
    | 'hot-standby'
    | 'active-active';
  estimatedCost?: number;
  estimatedAnnualCost?: number;
  estimatedProductionMonthlyCost?: number;
  costSource?: 'cloud_type_reference' | 'criticality_fallback' | 'user_override' | string;
  costSourceLabel?: string;
  costConfidence?: number;
  roiReliable?: boolean;
  roi?: number | null;
  roiStatus?: 'strongly_recommended' | 'rentable' | 'cost_exceeds_avoided_risk' | 'non_applicable' | string;
  roiMessage?: string;
  paybackMonths?: number | null;
  paybackLabel?: string;
  accepted?: boolean | null;
  status?: 'pending' | 'validated' | 'rejected';
  statusUpdatedAt?: string | null;
  statusHistory?: Array<{
    from: 'pending' | 'validated' | 'rejected';
    to: 'pending' | 'validated' | 'rejected';
    changedAt: string;
    notes: string | null;
  }>;
  notes?: string;
  description: string;
  priority: number | 'P0' | 'P1' | 'P2' | 'P3';
  title?: string;
  action?: string;
  category?: 'spof' | 'backup' | 'redundancy' | 'monitoring' | 'network' | 'process' | 'compliance';
  affectedNodeIds?: string[];
  source?: 'rule' | 'normative' | 'ai';
  confidence?: 'high' | 'medium' | 'low';
  normativeReference?: string;
  effort?: 'low' | 'medium' | 'high';
  budgetWarning?: string | null;
  requiresVerification?: boolean;
  withinBudgetCap?: boolean;
  calculation?: {
    aleCurrent: number;
    aleAfter: number;
    riskAvoidedAnnual: number;
    annualDrCost: number;
    formula: string;
    inputs: {
      hourlyDowntimeCost: number;
      currentRtoHours: number;
      targetRtoHours: number;
      incidentProbabilityAnnual: number;
      monthlyDrCost: number;
    };
  };
  sources?: string[];
  downtimeCostPerHour?: number;
  downtimeCostSource?: 'blast_radius' | 'override' | 'not_configured' | 'fallback_criticality' | string;
  downtimeCostSourceLabel?: string;
  downtimeCostRationale?: string;
  blastRadius?: {
    directDependents: number;
    transitiveDependents: number;
    totalServices: number;
    impactedServices: string[];
  };
}

export interface RecommendationsSummary {
  totalCost: number;
  totalAnnualCost?: number;
  byStrategy: Record<string, number>;
  annualCostByStrategy?: Record<string, number>;
  costSharePercentByStrategy?: Record<string, number>;
  totalRecommendations: number;
  secondaryRecommendations?: number;
  secondaryAnnualCost?: number;
  annualCostCap?: number;
  selectedAnnualCost?: number;
  remainingBudgetAnnual?: number | null;
  riskAvoidedAnnual?: number;
  roiPercent?: number | null;
  paybackMonths?: number | null;
  paybackLabel?: string;
  financialProfileConfigured?: boolean;
  currency?: string;
  budgetAnnual?: number | null;
  financialDisclaimers?: {
    profile?: string;
    strategy?: string;
    probability?: string;
    serviceCost?: string;
  };
}

export const recommendationsApi = {
  getAll: () =>
    api.get<Recommendation[]>('/recommendations/landing-zone'),

  getHybrid: () =>
    api.get<{ recommendations: Recommendation[] }>('/recommendations/hybrid'),

  getSummary: () =>
    api.get<RecommendationsSummary>('/recommendations/landing-zone/cost-summary'),

  updateStatus: (
    id: string,
    data: { status?: 'pending' | 'validated' | 'rejected'; accepted?: boolean | null; notes?: string | null },
  ) =>
    api.patch('/recommendations/landing-zone', { overrides: [{ serviceId: id, ...data }] }),

  regenerate: () =>
    api.post('/recommendations/regenerate'),

  resetStatus: (id: string) =>
    api.patch('/recommendations/landing-zone', { overrides: [{ serviceId: id, status: 'pending', notes: null }] }),
};
