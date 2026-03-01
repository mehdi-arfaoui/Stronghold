import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeStrategyCostPercentages } from '../src/services/landing-zone-cost-optimization.js';

test('normalizeStrategyCostPercentages returns integer shares summing exactly to 100', () => {
  const result = normalizeStrategyCostPercentages([
    { strategy: 'warm_standby', absoluteCost: 1_200 },
    { strategy: 'pilot_light', absoluteCost: 1_200 },
    { strategy: 'backup_restore', absoluteCost: 1_200 },
  ]);

  assert.deepEqual(Object.keys(result).sort(), ['backup_restore', 'pilot_light', 'warm_standby']);
  assert.deepEqual(
    [...Object.values(result)].sort((left, right) => left - right),
    [33, 33, 34],
  );
  assert.equal(Object.values(result).reduce((sum, value) => sum + value, 0), 100);
});

test('normalizeStrategyCostPercentages returns empty output when there is no positive cost', () => {
  assert.deepEqual(
    normalizeStrategyCostPercentages([
      { strategy: 'warm_standby', absoluteCost: 0 },
      { strategy: 'pilot_light', absoluteCost: -10 },
    ]),
    {},
  );
});
