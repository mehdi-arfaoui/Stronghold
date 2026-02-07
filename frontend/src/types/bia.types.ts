export interface BIAEntry {
  id: string;
  nodeId: string;
  serviceName: string;
  serviceType: string;
  tier: number;
  rto: number;
  rpo: number;
  mtpd: number;
  rtoSuggested: number;
  rpoSuggested: number;
  mtpdSuggested: number;
  validated: boolean;
  financialImpactPerHour?: number;
  dependencies: string[];
}

export interface BIASummary {
  totalServices: number;
  validatedCount: number;
  tiers: TierSummary[];
}

export interface TierSummary {
  tier: number;
  label: string;
  serviceCount: number;
  maxRTO: string;
  totalFinancialImpact: number;
}
