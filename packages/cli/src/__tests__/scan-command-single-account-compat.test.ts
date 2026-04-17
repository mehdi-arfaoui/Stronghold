import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAccountContext, createScanContext } from '@stronghold-dr/core';

import { createDemoResults, createTempDirectory } from './test-utils.js';

describe('scan command single-account compatibility', () => {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('keeps legacy single-account JSON output backward-compatible', async () => {
    const cwd = createLegacyWorkspace(`
version: 1
aws:
  profile: legacy-profile
  region: eu-west-3
`);
    process.chdir(cwd);

    const baseResults = await createDemoResults('minimal');
    const stdout: string[] = [];
    const stderr: string[] = [];

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    const coreModule = await import('@stronghold-dr/core');
    vi.spyOn(coreModule, 'getCallerIdentity').mockResolvedValue(null);

    const credentialsModule = await import('../config/credentials.js');
    const resolveAwsExecutionContextSpy = vi
      .spyOn(credentialsModule, 'resolveAwsExecutionContext')
      .mockResolvedValue({
        scanContext: createMockScanContext('111122223333', 'legacy'),
        regions: ['eu-west-3'],
        authMode: 'mock',
        authDescription: 'profile:legacy-profile',
        profile: 'legacy-profile',
      });

    const awsScanModule = await import('../pipeline/aws-scan.js');
    const runAwsScanSpy = vi.spyOn(awsScanModule, 'runAwsScan').mockResolvedValue(
      createMockAwsExecution(baseResults),
    );

    const programModule = await import('../index.js');
    await programModule.runCli([
      'node',
      'stronghold',
      'scan',
      '--no-save',
      '--output',
      'json',
    ]);

    expect(resolveAwsExecutionContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: 'legacy-profile',
        explicitRegions: ['eu-west-3'],
        allRegions: false,
      }),
    );
    expect(runAwsScanSpy).toHaveBeenCalledTimes(1);

    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>;
    expect(parsed.scan).toBeUndefined();
    expect(parsed.graph).toBeUndefined();
    expect(parsed.findings).toBeUndefined();
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.edges)).toBe(true);
    expect(Array.isArray(parsed.recommendations)).toBe(true);
    expect(stderr.join('')).not.toContain('Scanning 1 accounts...');
    expect(process.exitCode).toBe(0);
  });
});

function createLegacyWorkspace(configContents: string): string {
  const cwd = createTempDirectory('stronghold-single-account-');
  fs.mkdirSync(path.join(cwd, '.stronghold'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.stronghold', 'config.yml'), `${configContents.trim()}\n`, 'utf8');
  return cwd;
}

function createMockScanContext(accountId: string, alias: string) {
  const account = createAccountContext({
    accountId,
    accountAlias: alias,
  });

  return createScanContext({
    account,
    region: 'eu-west-3',
    authProvider: {
      kind: 'profile',
      canHandle: async () => true,
      getCredentials: async () => ({
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'secret',
      }),
      describeAuthMethod: () => 'profile:legacy-profile',
    },
  });
}

function createMockAwsExecution(
  results: Awaited<ReturnType<typeof createDemoResults>>,
) {
  return {
    results: {
      ...results,
      scanMetadata: {
        totalDurationMs: 1_500,
        scannerConcurrency: 5,
        scannerTimeoutMs: 60_000,
        scannedRegions: ['eu-west-3'],
        discoveredResourceCount: results.nodes.length,
        successfulScanners: 3,
        failedScanners: 0,
        scannerResults: [],
      },
    },
    warnings: results.warnings ?? [],
    scanMetadata: {
      totalDurationMs: 1_500,
      scannerConcurrency: 5,
      scannerTimeoutMs: 60_000,
      scannedRegions: ['eu-west-3'],
      discoveredResourceCount: results.nodes.length,
      successfulScanners: 3,
      failedScanners: 0,
      scannerResults: [],
    },
    regionResults: [
      {
        region: 'eu-west-3',
        durationMs: 1_500,
        resources: [],
        warnings: [],
        scannerResults: [],
      },
    ],
  };
}
