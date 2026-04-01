import { describe, expect, it } from 'vitest';

import { determineScanExitCode, determineSilentExitCode } from '../output/scan-summary.js';
import { createDemoResults } from './test-utils.js';

describe('exit codes', () => {
  it('returns 0 when at least one scanner succeeded', async () => {
    const results = await createDemoResults('enterprise');
    const withScanMetadata = {
      ...results,
      scanMetadata: {
        totalDurationMs: 2_000,
        scannerConcurrency: 5,
        scannerTimeoutMs: 60_000,
        scannedRegions: ['eu-west-1'],
        discoveredResourceCount: results.nodes.length,
        successfulScanners: 3,
        failedScanners: 1,
        scannerResults: [],
      },
    };

    expect(determineScanExitCode(withScanMetadata)).toBe(0);
  });

  it('returns 1 when all scanners failed', async () => {
    const results = await createDemoResults('minimal');
    const withScanMetadata = {
      ...results,
      scanMetadata: {
        totalDurationMs: 2_000,
        scannerConcurrency: 5,
        scannerTimeoutMs: 60_000,
        scannedRegions: ['eu-west-1'],
        discoveredResourceCount: 0,
        successfulScanners: 0,
        failedScanners: 3,
        scannerResults: [],
      },
    };

    expect(determineScanExitCode(withScanMetadata)).toBe(1);
  });

  it('keeps the legacy silent mode fallback when scan metadata is absent', async () => {
    const results = await createDemoResults('enterprise');

    expect(determineSilentExitCode(results.validationReport)).toBe(0);
    expect(determineScanExitCode(results)).toBe(0);
  });
});
