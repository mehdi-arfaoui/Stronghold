import { api } from './client';

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
