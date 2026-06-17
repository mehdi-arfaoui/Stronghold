import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Evidence } from '@stronghold-dr/core';

import { serializeScanResults } from '../storage/file-store.js';
import { createDemoResults, createTempDirectory } from './test-utils.js';

describe('stronghold contracts', () => {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('init creates starter contracts.yml', async () => {
    const cwd = createTempDirectory('stronghold-contracts-cli-');

    const output = await runCliIn(cwd, ['contracts', 'init']);

    expect(output.stdout).toContain('Created .stronghold/contracts.yml');
    expect(fs.existsSync(path.join(cwd, '.stronghold', 'contracts.yml'))).toBe(true);
  });

  it('init does not overwrite existing file', async () => {
    const cwd = createTempDirectory('stronghold-contracts-cli-');
    const contractsPath = path.join(cwd, '.stronghold', 'contracts.yml');
    fs.mkdirSync(path.dirname(contractsPath), { recursive: true });
    fs.writeFileSync(contractsPath, 'existing: true\n', 'utf8');

    const output = await runCliIn(cwd, ['contracts', 'init']);

    expect(output.stdout).toContain('already exists');
    expect(fs.readFileSync(contractsPath, 'utf8')).toBe('existing: true\n');
  });

  it('validate shows verdicts from latest scan', async () => {
    const cwd = await setupWorkspace({
      contracts: contractYaml({ service: 'database', enforcement: 'enforce', rto: '1h' }),
    });

    const output = await runCliIn(cwd, ['contracts', 'validate']);

    expect(output.stdout).toContain('Contracts: 1 requirements evaluated');
    expect(output.stdout).toContain('database / region_failure: UNKNOWN');
    expect(output.stdout).toContain('No tested evidence with measured RTO');
    expect(process.exitCode).toBe(0);
  });

  it('validate exits 2 when no scan exists', async () => {
    const cwd = createTempDirectory('stronghold-contracts-cli-');
    writeContracts(cwd, contractYaml({ service: 'database', enforcement: 'enforce', rto: '1h' }));

    const output = await runCliIn(cwd, ['contracts', 'validate']);

    expect(process.exitCode).toBe(2);
    expect(output.stderr).toContain('No scan found. Run `stronghold scan` or `stronghold demo` first.');
  });

  it('validate exits 2 when no contracts.yml exists', async () => {
    const cwd = await setupWorkspace({ contracts: null });

    const output = await runCliIn(cwd, ['contracts', 'validate']);

    expect(process.exitCode).toBe(2);
    expect(output.stderr).toContain('No contracts found. Run `stronghold contracts init`.');
  });

  it('validate exits 1 when enforce contract violated', async () => {
    const cwd = await setupWorkspace({
      contracts: contractYaml({ service: 'database', enforcement: 'enforce', rto: '1m' }),
      evidence: measuredEvidence({ measuredRTO: 45 }),
    });

    const output = await runCliIn(cwd, ['contracts', 'validate']);

    expect(process.exitCode).toBe(1);
    expect(output.stdout).toContain('VIOLATED');
    expect(output.stdout).toContain('1 enforceable violation');
  });

  it('validate exits 0 when warn contract violated', async () => {
    const cwd = await setupWorkspace({
      contracts: contractYaml({ service: 'database', enforcement: 'warn', rto: '1m' }),
      evidence: measuredEvidence({ measuredRTO: 45 }),
    });

    await runCliIn(cwd, ['contracts', 'validate']);

    expect(process.exitCode).toBe(0);
  });

  it('validate --format json produces parseable JSON', async () => {
    const cwd = await setupWorkspace({
      contracts: contractYaml({ service: 'database', enforcement: 'enforce', rto: '1h' }),
      evidence: measuredEvidence({ measuredRTO: 45 }),
    });

    const output = await runCliIn(cwd, ['contracts', 'validate', '--format', 'json']);
    const parsed = JSON.parse(output.stdout) as {
      readonly globalSummary: { readonly met: number };
    };

    expect(parsed.globalSummary.met).toBe(1);
    expect(process.exitCode).toBe(0);
  });

  it('validate --ci uses [PASS]/[FAIL]/[UNKNOWN]', async () => {
    const cwd = await setupWorkspace({
      contracts: contractYaml({ service: 'database', enforcement: 'enforce', rto: '1h' }),
    });

    const output = await runCliIn(cwd, ['contracts', 'validate', '--ci']);

    expect(output.stdout).toContain('[UNKNOWN]');
    expect(output.stdout).not.toContain('✓');
    expect(output.stdout).not.toContain('✗');
    expect(output.stdout).not.toContain('⚠');
  });

  it('validate exits 0 when no services match contracts', async () => {
    const cwd = await setupWorkspace({
      contracts: contractYaml({ service: 'missing-service', enforcement: 'enforce', rto: '1h' }),
    });

    const output = await runCliIn(cwd, ['contracts', 'validate']);

    expect(process.exitCode).toBe(0);
    expect(output.stdout).toContain('No services matched your contracts. Run `stronghold services list`.');
  });

  it('demo -> validate -> UNKNOWN -> evidence add -> validate -> MET', async () => {
    const cwd = createTempDirectory('stronghold-contracts-aha-');

    await runCliIn(cwd, ['demo', '--output', 'json']);
    expect(fs.existsSync(path.join(cwd, '.stronghold', 'contracts.yml'))).toBe(true);

    const firstValidation = await runCliIn(cwd, ['contracts', 'validate']);
    expect(firstValidation.stdout).toContain('UNKNOWN');
    expect(firstValidation.stdout).toContain('No tested evidence with measured RTO');

    await runCliIn(cwd, [
      'evidence',
      'add',
      '--service',
      'database',
      '--scenario',
      'region_failure',
      '--type',
      'tested',
      '--rto',
      '45m',
      '--rpo',
      '2m',
    ]);

    const secondValidation = await runCliIn(cwd, ['contracts', 'validate']);
    expect(secondValidation.stdout).toContain('MET');
    expect(secondValidation.stdout).toContain('Tested RTO 45m ≤ required 1h');
    expect(process.exitCode).toBe(0);
  });

  it('demo does not overwrite existing contracts.yml', async () => {
    const cwd = createTempDirectory('stronghold-contracts-demo-');
    const contractsPath = path.join(cwd, '.stronghold', 'contracts.yml');
    fs.mkdirSync(path.dirname(contractsPath), { recursive: true });
    fs.writeFileSync(contractsPath, 'version: "1"\ncontracts: []\n', 'utf8');

    await runCliIn(cwd, ['demo', '--output', 'json']);

    expect(fs.readFileSync(contractsPath, 'utf8')).toBe('version: "1"\ncontracts: []\n');
  });
});

interface WorkspaceOptions {
  readonly contracts: string | null;
  readonly evidence?: Evidence;
}

async function setupWorkspace(options: WorkspaceOptions): Promise<string> {
  const cwd = createTempDirectory('stronghold-contracts-cli-');
  fs.mkdirSync(path.join(cwd, '.stronghold'), { recursive: true });
  const results = await createDemoResults('startup');
  fs.writeFileSync(
    path.join(cwd, '.stronghold', 'latest-scan.json'),
    `${serializeScanResults(results)}\n`,
    'utf8',
  );
  if (options.contracts !== null) {
    writeContracts(cwd, options.contracts);
  }
  if (options.evidence) {
    fs.writeFileSync(
      path.join(cwd, '.stronghold', 'evidence.jsonl'),
      `${JSON.stringify(options.evidence)}\n`,
      'utf8',
    );
  }

  return cwd;
}

function writeContracts(cwd: string, contents: string): void {
  const contractsPath = path.join(cwd, '.stronghold', 'contracts.yml');
  fs.mkdirSync(path.dirname(contractsPath), { recursive: true });
  fs.writeFileSync(contractsPath, contents, 'utf8');
}

function contractYaml(input: {
  readonly service: string;
  readonly enforcement: 'warn' | 'enforce';
  readonly rto: string;
}): string {
  return `version: "1"
contracts:
  - service: ${input.service}
    enforcement: ${input.enforcement}
    requirements:
      - scenario: region_failure
        rto: ${input.rto}
`;
}

function measuredEvidence(overrides: {
  readonly measuredRTO?: number;
  readonly measuredRPO?: number;
}): Evidence {
  return {
    id: 'manual-rto',
    type: 'tested',
    source: {
      origin: 'test',
      testType: 'region_failure',
      testDate: '2026-06-17T00:00:00.000Z',
    },
    subject: {
      nodeId: 'service:database',
      serviceId: 'database',
    },
    observation: {
      key: 'scenario',
      value: {
        scenario: 'region_failure',
      },
      description: 'Measured demo recovery.',
    },
    timestamp: '2026-06-17T00:00:00.000Z',
    scenario: 'region_failure',
    ...overrides,
  };
}

async function runCliIn(
  cwd: string,
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  process.chdir(cwd);
  process.exitCode = undefined;
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

  const programModule = await import('../index.js');
  await programModule.runCli(['node', 'stronghold', ...args]);

  return {
    stdout: stdout.join(''),
    stderr: stderr.join(''),
  };
}
