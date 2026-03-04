import assert from 'node:assert/strict';
import test from 'node:test';

import { runPostScanEnrichments } from '../src/discovery/discoveryOrchestrator.ts';

test('runPostScanEnrichments keeps recommendations generation non-blocking when BIA fails', async () => {
  const calls: string[] = [];
  const warnings: string[] = [];

  await runPostScanEnrichments({} as never, 'tenant-enrichment', {
    logger: {
      info() {
        return undefined;
      },
      warn(message: unknown) {
        warnings.push(String(message));
      },
    },
    autoGenerateBia: async () => {
      calls.push('bia');
      throw new Error('bia failed');
    },
    autoGenerateRecommendations: async () => {
      calls.push('recommendations');
      return { recommendations: [{ id: 'lz-1' }] };
    },
  });

  assert.deepEqual(calls, ['bia', 'recommendations']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] || '', /BIA auto-generation failed/i);
});
