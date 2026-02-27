import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeType } from '../../graph/types.js';
import {
  biaSuggestionService,
  validateRTORPOConsistency,
} from '../../bia/services/bia-suggestion.service.js';

test('validateRTORPOConsistency caps RTO/RPO by tier maxima', () => {
  const [tier1, tier2, tier3, tier4] = validateRTORPOConsistency([
    { tier: 1, rtoMinutes: 180, rpoMinutes: 60 },
    { tier: 2, rtoMinutes: 90, rpoMinutes: 30 },
    { tier: 3, rtoMinutes: 600, rpoMinutes: 120 },
    { tier: 4, rtoMinutes: 2000, rpoMinutes: 900 },
  ]);

  assert.deepEqual(tier1, { tier: 1, rtoMinutes: 15, rpoMinutes: 1 });
  assert.deepEqual(tier2, { tier: 2, rtoMinutes: 60, rpoMinutes: 15 });
  assert.deepEqual(tier3, { tier: 3, rtoMinutes: 240, rpoMinutes: 60 });
  assert.deepEqual(tier4, { tier: 4, rtoMinutes: 1440, rpoMinutes: 720 });
});

test('BIASuggestionService enforces tier caps when tier is provided', () => {
  const suggestion = biaSuggestionService.suggestForNode(
    {
      id: 'svc-1',
      name: 'archive-storage',
      type: NodeType.OBJECT_STORAGE,
      provider: 'aws',
      metadata: {},
      tags: {},
      criticalityScore: 90,
    } as any,
    {
      graph: {
        inDegree: () => 0,
      } as any,
      explicitCriticalityScore: 90,
      tier: 1,
    },
  );

  assert.ok(suggestion.rto <= 15, `expected tier-1 RTO cap, got ${suggestion.rto}`);
  assert.ok(suggestion.rpo <= 1, `expected tier-1 RPO cap, got ${suggestion.rpo}`);
  assert.ok(
    suggestion.reasoning.some((item) => item.includes('Cohérence tier appliquee')),
    'expected reasoning to mention tier consistency cap',
  );
});
