import type { DrStrategyKey } from '../../../constants/dr-financial-reference-data.js';
import type { CloudProvider, CloudServiceResolution } from '../types.js';

export type RuleProvider = 'aws' | 'azure' | 'gcp' | '*';

export interface RecommendationRuleNode {
  id: string;
  name: string;
  type: string;
  provider: CloudProvider;
  metadata: Record<string, unknown>;
  resolution: CloudServiceResolution;
  region?: string | null;
  availabilityZone?: string | null;
}

export interface ResilienceRuleResult {
  title: string;
  description: string;
  action: string;
  costDeltaMultiplier: number;
  costDeltaFixed?: number;
  strategy: DrStrategyKey;
  newRTO?: string;
  requiresVerification?: boolean;
}

export interface ResilienceRule {
  id: string;
  provider: RuleProvider;
  kinds?: string[];
  appliesTo(node: RecommendationRuleNode): boolean;
  isSatisfied(node: RecommendationRuleNode): boolean;
  generate(node: RecommendationRuleNode, baseCostMonthly: number): ResilienceRuleResult;
  criticalMetadata?: string[];
}

export interface EvaluatedRecommendation {
  ruleId: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  provider: CloudProvider;
  result: ResilienceRuleResult;
  baseCostMonthly: number;
  costDeltaMonthly: number;
  costDeltaAnnual: number;
  pricingSource: string;
  pricingConfidence: number;
  resilientByDesign: boolean;
  missingCriticalMetadata: string[];
}
