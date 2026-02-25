import type {
  DrStrategyKey,
  IncidentProbabilityKey,
} from '../../constants/dr-financial-reference-data.js';

export type CloudProvider = 'aws' | 'azure' | 'gcp' | 'other';

export type CriticalityLevel = 'critical' | 'high' | 'medium' | 'low';

export type CloudServiceCategory =
  | 'compute'
  | 'database_relational'
  | 'database_nosql'
  | 'cache'
  | 'storage'
  | 'serverless'
  | 'messaging'
  | 'kubernetes'
  | 'loadbalancer'
  | 'unknown';

export type CloudServiceResolution = {
  provider: CloudProvider;
  category: CloudServiceCategory;
  kind: string;
  nodeType: string;
  sourceType: string;
  metadata: Record<string, unknown>;
  descriptors: string[];
};

export type ServiceRecommendationText = {
  action: string;
  resilienceImpact: string;
  text: string;
};

export type IncidentProbabilityResult = {
  key: IncidentProbabilityKey;
  probabilityAnnual: number;
  source: string;
};

export type ServiceRecommendationBuildInput = {
  serviceName: string;
  monthlyLabel: string;
  resolution: CloudServiceResolution;
  strategy: DrStrategyKey;
};

export type DrProviderAdapter = {
  lookupEstimatedMonthlyUsd: (resolution: CloudServiceResolution) => number | null;
  resolveFloorStrategy: (
    criticality: CriticalityLevel,
    defaultFloor: DrStrategyKey,
    resolution: CloudServiceResolution,
  ) => DrStrategyKey | null;
  resolveNativeCostFactor: (
    strategy: DrStrategyKey,
    resolution: CloudServiceResolution,
  ) => number | null;
  resolveIncidentProbability: (resolution: CloudServiceResolution) => IncidentProbabilityResult | null;
  buildRecommendation: (input: ServiceRecommendationBuildInput) => ServiceRecommendationText | null;
};
