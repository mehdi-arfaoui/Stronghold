import { describe, expect, it } from 'vitest';

import '../../drp/runbook/runbook-generator.js';
import { listRegisteredStrategyDefinitions } from '../../drp/runbook/strategy-registry.js';
import { classifyRecommendationRisk } from '../risk-classifier.js';

describe('classifyRecommendationRisk', () => {
  it('ensures registered runbook strategies expose an execution risk', () => {
    const definitions = listRegisteredStrategyDefinitions();
    const entries = Object.entries(definitions);

    expect(entries.length).toBeGreaterThanOrEqual(13);
    entries.forEach(([, definition]) => {
      expect(definition.executionRisk).toBeDefined();
      expect(['safe', 'caution', 'dangerous']).toContain(definition.executionRisk);
    });
  });

  it('ensures every registered strategy exposes a non-empty risk reason', () => {
    const definitions = listRegisteredStrategyDefinitions();

    Object.values(definitions).forEach((definition) => {
      expect(definition.riskReason.trim().length).toBeGreaterThan(0);
    });
  });

  it('defaults to caution when no matching strategy exists', () => {
    expect(classifyRecommendationRisk('missing-node-type', 'missing-strategy')).toEqual({
      risk: 'caution',
      riskReason: 'No matching runbook strategy declared a risk level for this action.',
    });
  });
});
