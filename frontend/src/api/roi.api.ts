import { api } from './client';

export interface SPOFRiskDetail {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  provider: string;
  rtoMinutes: number;
  dependentServices: number;
  blastRadius: number;
  failureProbability: number;
  annualExpectedLoss: number;
  recommendedStrategy: string;
  remediationMonthlyCost: { min: number; max: number; median: number };
}

export interface ROIReport {
  annualSavings: number;
  roiPercentage: number;
  paybackPeriodMonths: number;
  breakdown: {
    currentAnnualRisk: number;
    riskReduction: number;
    annualRemediationCost: number;
    netBenefit: number;
  };
  riskDetails: {
    spofCount: number;
    avgRtoHours: number;
    hourlyCost: number;
    annualExpectedLoss: number;
    perSpof?: SPOFRiskDetail[];
  };
  remediationDetails: {
    monthlyCloudCost: number;
    monthlySubscription: number;
    totalMonthlyCost: number;
  };
  complianceCoverage: Record<string, { total: number; covered: number; percentage: number }>;
  methodology: {
    downtimeCostSource: string;
    riskReductionAssumption: string;
    spofFailureProbability: string;
    calculationDetails?: string;
    disclaimer: string;
  };
}

export const roiApi = {
  getROI: (params?: { companySize?: string; vertical?: string; currency?: string; hourlyCost?: number }) =>
    api.get<ROIReport>('/roi', { params }),

  getMarketData: () =>
    api.get('/roi/market-data'),

  getRecoveryStrategies: () =>
    api.get('/roi/recovery-strategies'),

  getComplianceCoverage: (features: string[]) =>
    api.get('/roi/compliance/coverage', { params: { features: features.join(',') } }),
};
