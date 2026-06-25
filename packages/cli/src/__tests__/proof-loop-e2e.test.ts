import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('Proof Loop E2E', () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const cwd = path.resolve(testDir, '../../../../');
  const strongholdDir = path.join(cwd, '.stronghold');
  const cliArgs = ['--import', 'tsx', 'packages/cli/src/index.ts'];
  const testTimeoutMs = 120_000;

  async function run(command: readonly string[]): Promise<{
    readonly stdout: string;
    readonly exitCode: number;
  }> {
    try {
      const { stdout } = await execFileAsync(process.execPath, [...cliArgs, ...command], {
        cwd,
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
        timeout: 30_000,
        windowsHide: true,
      });
      return { stdout, exitCode: 0 };
    } catch (error) {
      return readExecFailure(error);
    }
  }

  beforeEach(() => {
    cleanStrongholdState();
  });

  afterAll(() => {
    cleanStrongholdState();
  });

  it('complete proof loop: demo -> UNKNOWN -> evidence -> MET', async () => {
    const demo = await run(['demo']);
    expect(demo.exitCode).toBe(0);
    expect(demo.stdout).not.toContain('unknown time');
    expect(existsSync(path.join(strongholdDir, 'latest-scan.json'))).toBe(true);
    expect(existsSync(path.join(strongholdDir, 'contracts.yml'))).toBe(true);

    const serviceName = readDemoContractService();

    const validate1 = await run(['contracts', 'validate']);
    expect(validate1.stdout).toContain('UNKNOWN');
    expect(validate1.stdout).not.toContain('MET');
    expect(validate1.stdout).toContain(`${serviceName} / region_failure: UNKNOWN`);
    expect(validate1.stdout).toContain('evidence add');
    expect(validate1.stdout).toContain(`--service ${serviceName}`);
    expect(validate1.stdout).toContain('--rto <measured_duration> --rpo <measured_duration>');

    const evidence = await run([
      'evidence',
      'add',
      '--service',
      serviceName,
      '--scenario',
      'region_failure',
      '--type',
      'tested',
      '--rto',
      '45m',
      '--rpo',
      '2m',
    ]);
    expect(evidence.exitCode).toBe(0);

    const validate2 = await run(['contracts', 'validate']);
    expect(validate2.stdout).toContain('MET');
    expect(validate2.stdout).not.toContain('UNKNOWN');
    expect(validate2.stdout).toContain('45m');
  }, testTimeoutMs);

  it('contracts validate --format json produces valid JSON with MET', async () => {
    await run(['demo']);
    const serviceName = readDemoContractService();
    await run([
      'evidence',
      'add',
      '--service',
      serviceName,
      '--scenario',
      'region_failure',
      '--type',
      'tested',
      '--rto',
      '45m',
      '--rpo',
      '2m',
    ]);

    const result = await run(['contracts', 'validate', '--format', 'json']);
    const json = JSON.parse(result.stdout) as {
      readonly globalSummary: {
        readonly met: number;
        readonly unknown: number;
      };
    };
    expect(json.globalSummary.met).toBeGreaterThanOrEqual(1);
    expect(json.globalSummary.unknown).toBe(0);
  }, testTimeoutMs);

  it('contracts validate --ci uses [PASS] text', async () => {
    await run(['demo']);
    const serviceName = readDemoContractService();
    await run([
      'evidence',
      'add',
      '--service',
      serviceName,
      '--scenario',
      'region_failure',
      '--type',
      'tested',
      '--rto',
      '45m',
      '--rpo',
      '2m',
    ]);

    const result = await run(['contracts', 'validate', '--ci']);
    expect(result.stdout).toContain('[PASS]');
    expect(result.stdout).not.toContain('\u2713');
  }, testTimeoutMs);

  it('clean state: no pre-existing .stronghold/ contamination', async () => {
    const demo = await run(['demo']);
    expect(demo.exitCode).toBe(0);
    expect(demo.stdout).not.toContain('previous scan');
    expect(demo.stdout).not.toContain('trend');
    expect(demo.stdout).not.toContain('unknown time');
  }, testTimeoutMs);

  function cleanStrongholdState(): void {
    if (existsSync(strongholdDir)) {
      rmSync(strongholdDir, { recursive: true, force: true });
    }
  }

  function readDemoContractService(): string {
    const contractsYml = readFileSync(path.join(strongholdDir, 'contracts.yml'), 'utf-8');
    return contractsYml.match(/service:\s*["']?([^"'\s]+)/u)?.[1] ?? 'startup-api';
  }
});

function readExecFailure(error: unknown): { readonly stdout: string; readonly exitCode: number } {
  if (!isExecFailure(error)) {
    throw error;
  }

  return {
    stdout: readFailureOutput(error.stdout),
    exitCode: typeof error.status === 'number'
      ? error.status
      : typeof error.code === 'number'
        ? error.code
        : 1,
  };
}

function isExecFailure(error: unknown): error is {
  readonly stdout?: unknown;
  readonly status?: unknown;
  readonly code?: unknown;
} {
  return typeof error === 'object' && error !== null;
}

function readFailureOutput(stdout: unknown): string {
  if (typeof stdout === 'string') {
    return stdout;
  }
  if (Buffer.isBuffer(stdout)) {
    return stdout.toString('utf8');
  }
  return '';
}
