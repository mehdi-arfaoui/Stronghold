export interface BIASuggestion {
  rto: number;
  rpo: number;
  mtpd: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string[];
  adjustments: {
    backupFrequency?: string;
    replication?: string;
    dependencies?: string;
    spof?: string;
  };
}

export interface BIAEntry {
  id: string;
  nodeId: string;
  serviceName: string;
  serviceType: string;
  tier: number;
  rto: number | null;
  rpo: number | null;
  mtpd: number | null;
  rtoSuggested: number;
  rpoSuggested: number;
  mtpdSuggested: number;
  suggestion?: BIASuggestion;
  effectiveRto?: number;
  effectiveRpo?: number;
  effectiveMtpd?: number;
  validated: boolean;
  financialImpactPerHour?: number;
  financialConfidence?: 'user_defined' | 'estimated' | 'low_confidence';
  financialSources?: string[];
  financialIsOverride?: boolean;
  financialOverride?: {
    customCostPerHour: number;
    justification?: string | null;
    validatedBy?: string | null;
    validatedAt?: string | null;
  } | null;
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
