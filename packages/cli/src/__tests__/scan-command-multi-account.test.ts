import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAccountContext, createScanContext } from '@stronghold-dr/core';

import { createDemoResults, createTempDirectory } from './test-utils.js';

describe('scan command multi-account', () => {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('prints multi-account progress and returns exit code 1 on partial failure', async () => {
    const cwd = createMultiAccountWorkspace(`
aws:
  region: eu-west-1
  accounts:
    - account_id: "111122223333"
      alias: prod
      auth:
        kind: profile
        profile_name: prod
    - account_id: "444455556666"
      alias: data
      auth:
        kind: profile
        profile_name: data
`);
    process.chdir(cwd);

    const baseResults = await createDemoResults('minimal');
    const stderr: string[] = [];
    const stdout: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    const credentialsModule = await import('../config/credentials.js');
    vi.spyOn(credentialsModule, 'resolveAwsExecutionContext').mockImplementation(async (options) => {
      if (options.accountId === '444455556666') {
        throw new Error('Access Denied on AssumeRole');
      }

      return {
        scanContext: createMockScanContext('111122223333', 'prod'),
        regions: ['eu-west-1'],
        authMode: 'mock',
        accountName: 'prod',
        profile: 'prod',
      };
    });

    const awsScanModule = await import('../pipeline/aws-scan.js');
    vi.spyOn(awsScanModule, 'runAwsScan').mockResolvedValue(
      createMockAwsExecution(baseResults),
    );

    const programModule = await import('../index.js');
    await programModule.runCli(['node', 'stronghold', 'scan', '--no-save']);

    const errorOutput = stderr.join('');
    expect(errorOutput).toContain('Scanning 2 accounts...');
    expect(errorOutput).toContain('FAIL data (444455556666) - authentication failed: Access Denied on AssumeRole');
    expect(errorOutput).toContain('OK prod (111122223333)');
    expect(errorOutput).toContain('Scan complete: 1/2 accounts scanned');
    expect(process.exitCode).toBe(1);
    expect(stdout.join('')).toContain('Scan complete');
  });

  it('keeps stdout parseable in JSON mode and enriches the payload', async () => {
    const cwd = createMultiAccountWorkspace(`
aws:
  region: eu-west-1
  accounts:
    - account_id: "111122223333"
      alias: prod
      auth:
        kind: profile
        profile_name: prod
    - account_id: "444455556666"
      alias: data
      auth:
        kind: profile
        profile_name: data
`);
    process.chdir(cwd);

    const baseResults = await createDemoResults('minimal');
    const stderr: string[] = [];
    const stdout: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    const credentialsModule = await import('../config/credentials.js');
    vi.spyOn(credentialsModule, 'resolveAwsExecutionContext').mockImplementation(async (options) => {
      if (options.accountId === '444455556666') {
        throw new Error('Access Denied on AssumeRole');
      }

      return {
        scanContext: createMockScanContext('111122223333', 'prod'),
        regions: ['eu-west-1'],
        authMode: 'mock',
        accountName: 'prod',
        profile: 'prod',
      };
    });

    const awsScanModule = await import('../pipeline/aws-scan.js');
    vi.spyOn(awsScanModule, 'runAwsScan').mockResolvedValue(
      createMockAwsExecution(baseResults),
    );

    const programModule = await import('../index.js');
    await programModule.runCli(['node', 'stronghold', 'scan', '--no-save', '--output', 'json']);

    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.scan.accounts).toHaveLength(2);
    expect(parsed.scan.errors).toHaveLength(1);
    expect(parsed.summary).toBeUndefined();
    expect(parsed.graph.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(stderr.join('')).toContain('Scanning 2 accounts...');
    expect(process.exitCode).toBe(1);
  });

  it('returns exit code 3 when authentication fails for every configured account', async () => {
    const cwd = createMultiAccountWorkspace(`
aws:
  region: eu-west-1
  accounts:
    - account_id: "111122223333"
      alias: prod
    - account_id: "444455556666"
      alias: data
`);
    process.chdir(cwd);

    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    const credentialsModule = await import('../config/credentials.js');
    vi.spyOn(credentialsModule, 'resolveAwsExecutionContext').mockRejectedValue(
      new Error('No credentials available'),
    );

    const awsScanModule = await import('../pipeline/aws-scan.js');
    const runAwsScanSpy = vi.spyOn(awsScanModule, 'runAwsScan');

    const programModule = await import('../index.js');
    await programModule.runCli(['node', 'stronghold', 'scan', '--no-save']);

    expect(process.exitCode).toBe(3);
    expect(runAwsScanSpy).not.toHaveBeenCalled();
    expect(stderr.join('')).toContain('Scan Errors:');
  });
});

function createMultiAccountWorkspace(configContents: string): string {
  const cwd = createTempDirectory('stronghold-multi-account-');
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
    region: 'eu-west-1',
    authProvider: {
      kind: 'profile',
      canHandle: async () => true,
      getCredentials: async () => ({
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'secret',
      }),
      describeAuthMethod: () => 'profile:test',
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
        scannedRegions: ['eu-west-1'],
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
      scannedRegions: ['eu-west-1'],
      discoveredResourceCount: results.nodes.length,
      successfulScanners: 3,
      failedScanners: 0,
      scannerResults: [],
    },
    regionResults: [
      {
        region: 'eu-west-1',
        durationMs: 1_500,
        resources: [],
        warnings: [],
        scannerResults: [],
      },
    ],
  };
}
