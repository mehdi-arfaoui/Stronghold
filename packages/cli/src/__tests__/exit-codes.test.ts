import { describe, expect, it } from 'vitest';

import { determineSilentExitCode } from '../output/scan-summary.js';
import { createDemoResults } from './test-utils.js';

describe('exit codes', () => {
  it('returns 0 in silent mode when score is at least 60', async () => {
    const results = await createDemoResults('enterprise');

    expect(determineSilentExitCode(results.validationReport)).toBe(0);
  });

  it('returns 1 in silent mode when score is below 60', async () => {
    const results = await createDemoResults('minimal');

    expect(determineSilentExitCode(results.validationReport)).toBe(1);
  });
});
