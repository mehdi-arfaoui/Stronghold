import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDemoResults, createTempDirectory } from './test-utils.js';

describe('scan command executive summary', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('prints the executive summary before recommendations', async () => {
    const baseResults = await createDemoResults('startup');
    const results = {
      ...baseResults,
      scanMetadata: {
        discoveredResourceCount: baseResults.nodes.length,
        totalDurationMs: 1_500,
        scannerConcurrency: 5,
        scannerTimeoutMs: 60_000,
        successfulScanners: 3,
        failedScanners: 0,
        scannedRegions: [...baseResults.regions],
        scannerResults: [],
      },
    };
    const execution = {
      results,
      warnings: results.warnings ?? [],
      scanMetadata: results.scanMetadata,
      regionResults: [],
    };

    const credentialsModule = await import('../config/credentials.js');
    vi.spyOn(credentialsModule, 'resolveAwsExecutionContext').mockResolvedValue({
      credentials: { aws: {} },
      regions: ['eu-west-1'],
      authMode: 'mock',
    });

    const auditModule = await import('../audit/command-audit.js');
    vi.spyOn(auditModule, 'resolveAuditIdentity').mockResolvedValue(null);

    const awsScanModule = await import('../pipeline/aws-scan.js');
    vi.spyOn(awsScanModule, 'runAwsScan').mockResolvedValue(
      execution as Awaited<ReturnType<typeof awsScanModule.runAwsScan>>,
    );

    const cwd = createTempDirectory('stronghold-scan-summary-');
    process.chdir(cwd);

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    const programModule = await import('../index.js');
    await programModule.createProgram().parseAsync([
      'node',
      'stronghold',
      'scan',
      '--region',
      'eu-west-1',
    ]);

    const output = writes.join('');
    expect(output).toContain('Stronghold DR Intelligence');
    expect(output.indexOf('Stronghold DR Intelligence')).toBeLessThan(output.indexOf('Top Recommendations'));
  });
});
