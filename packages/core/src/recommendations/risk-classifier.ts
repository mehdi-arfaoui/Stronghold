import '../drp/runbook/runbook-generator.js';
import '../drp/runbook/strategies/recommendation-risk-profiles.js';
import { getRunbookStrategyDefinition } from '../drp/runbook/strategy-registry.js';
import type { ExecutionRisk } from '../drp/runbook/runbook-types.js';

export interface RecommendationRisk {
  readonly risk: ExecutionRisk;
  readonly riskReason: string;
}

export function classifyRecommendationRisk(
  nodeType: string,
  strategy: string,
): RecommendationRisk {
  const definition = getRunbookStrategyDefinition(nodeType, strategy);
  if (!definition) {
    return {
      risk: 'caution',
      riskReason: 'No matching runbook strategy declared a risk level for this action.',
    };
  }

  return {
    risk: definition.executionRisk,
    riskReason: definition.riskReason,
  };
}
