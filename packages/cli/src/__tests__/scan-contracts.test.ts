import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAccountContext,
  createScanContext,
  type Evidence,
} from '@stronghold-dr/core';

import { createDemoResults, createTempDirectory } from './test-utils.js';

describe('scan command contract integration', () => {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('returns exit code 1 for enforce violations', async () => {
    const setup = await setupWorkspace({ enforcement: 'enforce', measuredRTO: 90 });

    await runScan(setup.cwd, ['--no-save', '--output', 'silent']);

    expect(process.exitCode).toBe(1);
  });

  it('keeps exit code 0 for warn violations', async () => {
    const setup = await setupWorkspace({ enforcement: 'warn', measuredRTO: 90 });

    await runScan(setup.cwd, ['--no-save', '--output', 'silent']);

    expect(process.exitCode).toBe(0);
  });

  it('fires hooks for enforce violations and still returns exit code 1', async () => {
    const fetchMock = mockFetch();
    const setup = await setupWorkspace({
      enforcement: 'enforce',
      measuredRTO: 90,
      hooks: true,
    });

    await runScan(setup.cwd, ['--no-save', '--output', 'silent']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });

  it('fires hooks for warn violations and keeps exit code 0', async () => {
    const fetchMock = mockFetch();
    const setup = await setupWorkspace({
      enforcement: 'warn',
      measuredRTO: 90,
      hooks: true,
    });

    await runScan(setup.cwd, ['--no-save', '--output', 'silent']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it('does not fire hooks when --no-hooks is used', async () => {
    const fetchMock = mockFetch();
    const setup = await setupWorkspace({
      enforcement: 'enforce',
      measuredRTO: 90,
      hooks: true,
    });

    await runScan(setup.cwd, ['--no-save', '--output', 'silent', '--no-hooks']);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('omits contracts from JSON when contracts.yml is absent', async () => {
    const setup = await setupWorkspace({
      enforcement: 'warn',
      measuredRTO: 30,
      writeContractsFile: false,
    });

    const output = await runScan(setup.cwd, ['--no-save', '--format', 'json']);
    const parsed = JSON.parse(output.stdout) as { readonly contracts?: unknown };

    expect(parsed.contracts).toBeUndefined();
    expect(process.exitCode).toBe(0);
  });

  it('includes met contract results in JSON without changing exit code', async () => {
    const setup = await setupWorkspace({ enforcement: 'enforce', measuredRTO: 30 });

    const output = await runScan(setup.cwd, ['--no-save', '--format', 'json']);
    const parsed = JSON.parse(output.stdout) as {
      readonly contracts?: {
        readonly evaluated: boolean;
        readonly enforceableViolations: number;
        readonly globalSummary: { readonly met: number };
      };
    };

    expect(parsed.contracts?.evaluated).toBe(true);
    expect(parsed.contracts?.enforceableViolations).toBe(0);
    expect(parsed.contracts?.globalSummary.met).toBeGreaterThan(0);
    expect(process.exitCode).toBe(0);
  });

  it('prints symbolic contract output in summary mode', async () => {
    const setup = await setupWorkspace({ enforcement: 'warn', measuredRTO: 90 });

    const output = await runScan(setup.cwd, ['--no-save']);

    expect(output.stdout).toContain('Contracts: 1 evaluated');
    expect(output.stdout).toContain('\u2717');
    expect(output.stdout).toContain(`${setup.serviceName}:`);
  });

  it('prints CI labels in --ci mode', async () => {
    const setup = await setupWorkspace({ enforcement: 'warn', measuredRTO: 90 });

    const output = await runScan(setup.cwd, ['--no-save', '--ci']);

    expect(output.stdout).toContain('[FAIL]');
    expect(output.stdout).toContain(`  [FAIL] ${setup.serviceName}:`);
  });

  it('writes an aggregate audit trail entry', async () => {
    const setup = await setupWorkspace({
      enforcement: 'enforce',
      measuredRTO: 90,
      hooks: true,
    });
    mockFetch();

    await runScan(setup.cwd, ['--no-save', '--output', 'silent']);

    const auditPath = path.join(setup.cwd, '.stronghold', 'audit.jsonl');
    const entries = fs.readFileSync(auditPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {
        readonly action: string;
        readonly details?: {
          readonly contractCount?: number;
          readonly violated?: number;
          readonly enforceableViolations?: number;
          readonly hooksFired?: number;
        };
      });
    const contractEntry = entries.find((entry) => entry.action === 'contract_evaluated');

    expect(contractEntry?.details).toEqual({
      contractCount: 1,
      met: 0,
      violated: expect.any(Number) as number,
      unknown: 0,
      enforceableViolations: expect.any(Number) as number,
      hooksFired: 1,
    });
    expect(contractEntry?.details?.violated).toBeGreaterThan(0);
    expect(contractEntry?.details?.enforceableViolations).toBeGreaterThan(0);
  });
});

interface WorkspaceSetupOptions {
  readonly enforcement: 'warn' | 'enforce';
  readonly measuredRTO: number;
  readonly hooks?: boolean;
  readonly writeContractsFile?: boolean;
}

async function setupWorkspace(options: WorkspaceSetupOptions): Promise<{
  readonly cwd: string;
  readonly serviceName: string;
}> {
  const cwd = createWorkspace();
  process.chdir(cwd);
  const results = await createResultsWithMetadata();
  const service = results.servicePosture?.services[0]?.service;
  if (!service) {
    throw new Error('Demo results must include at least one service.');
  }

  writeEvidence(cwd, service.id, options.measuredRTO);
  if (options.writeContractsFile !== false) {
    writeContracts(cwd, {
      serviceName: service.name,
      enforcement: options.enforcement,
      hooks: options.hooks === true,
    });
  }
  await installScanMocks(results);

  return {
    cwd,
    serviceName: service.name,
  };
}

async function runScan(
  cwd: string,
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  process.chdir(cwd);
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
  await programModule.runCli(['node', 'stronghold', 'scan', ...args]);

  return {
    stdout: stdout.join(''),
    stderr: stderr.join(''),
  };
}

async function installScanMocks(
  results: Awaited<ReturnType<typeof createResultsWithMetadata>>,
): Promise<void> {
  const coreModule = await import('@stronghold-dr/core');
  vi.spyOn(coreModule, 'getCallerIdentity').mockResolvedValue(null);

  const credentialsModule = await import('../config/credentials.js');
  vi.spyOn(credentialsModule, 'resolveAwsExecutionContext').mockResolvedValue({
    scanContext: createMockScanContext(),
    regions: ['eu-west-1'],
    authMode: 'mock',
    authDescription: 'mock',
  });

  const awsScanModule = await import('../pipeline/aws-scan.js');
  vi.spyOn(awsScanModule, 'runAwsScan').mockResolvedValue({
    results,
    warnings: results.warnings ?? [],
    scanMetadata: results.scanMetadata,
    regionResults: [],
  });
}

function createWorkspace(): string {
  const cwd = createTempDirectory('stronghold-scan-contracts-');
  fs.mkdirSync(path.join(cwd, '.stronghold'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.stronghold', 'config.yml'),
    'version: 1\naws:\n  region: eu-west-1\n',
    'utf8',
  );
  return cwd;
}

async function createResultsWithMetadata() {
  const results = await createDemoResults('startup');
  return {
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
  };
}

function writeContracts(
  cwd: string,
  options: {
    readonly serviceName: string;
    readonly enforcement: 'warn' | 'enforce';
    readonly hooks: boolean;
  },
): void {
  fs.writeFileSync(
    path.join(cwd, '.stronghold', 'contracts.yml'),
    `
version: "1"
contracts:
  - service: ${JSON.stringify(options.serviceName)}
    enforcement: ${options.enforcement}
${options.hooks ? `    hooks:
      - type: webhook
        url: https://hooks.example.com/services/secret-token
        on: [violated]
` : ''}    requirements:
      - scenario: "*"
        rto: 1h
`,
    'utf8',
  );
}

function writeEvidence(cwd: string, serviceId: string, measuredRTO: number): void {
  const evidence: Evidence = {
    id: 'contract-rto-evidence',
    type: 'tested',
    source: {
      origin: 'test',
      testType: 'restore-drill',
      testDate: '2026-06-01T00:00:00.000Z',
    },
    subject: {
      nodeId: 'contract-test-node',
      serviceId,
    },
    observation: {
      key: 'restore-drill',
      value: 'measured recovery',
      description: 'Measured recovery drill for contract tests.',
    },
    timestamp: '2026-06-01T00:00:00.000Z',
    measuredRTO,
  };

  fs.writeFileSync(
    path.join(cwd, '.stronghold', 'evidence.jsonl'),
    `${JSON.stringify(evidence)}\n`,
    'utf8',
  );
}

function createMockScanContext() {
  const account = createAccountContext({
    accountId: '111122223333',
    accountAlias: 'contract-test',
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
      describeAuthMethod: () => 'mock',
    },
  });
}

function mockFetch(): ReturnType<
  typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>
> {
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
