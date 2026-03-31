import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ActionConfig } from './config';
import { validateCredentials } from './aws-credentials';

const SCAN_TIMEOUT_MS = 300_000;
const REPORT_TIMEOUT_MS = 30_000;

export interface ScanFailure {
  readonly ruleId: string;
  readonly nodeId: string;
  readonly message: string;
  readonly impact: string;
  readonly severity: string;
}

export interface ScanResult {
  readonly score: number;
  readonly grade: string;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly totalChecks: number;
  readonly passed: number;
  readonly failed: number;
  readonly warnings: number;
  readonly categories: Readonly<Record<string, number>>;
  readonly topFailures: readonly ScanFailure[];
  readonly failureIds: readonly string[];
}

interface CommandExecution {
  readonly exitCode: number;
  readonly stderr: string;
}

interface ReportFile {
  readonly totalChecks?: number;
  readonly passed?: number;
  readonly failed?: number;
  readonly warnings?: number;
  readonly results?: readonly ReportResult[];
  readonly criticalFailures?: readonly ReportFailure[];
  readonly score?: number;
  readonly scoreBreakdown?: ReportScoreBreakdown;
}

interface ReportResult {
  readonly severity?: string;
  readonly status?: string;
}

interface ReportFailure {
  readonly ruleId?: string;
  readonly nodeId?: string;
  readonly message?: string;
  readonly severity?: string;
  readonly weightBreakdown?: {
    readonly directDependentCount?: number;
  };
}

interface ReportScoreBreakdown {
  readonly overall?: number;
  readonly grade?: string;
  readonly byCategory?: Record<string, number>;
}

export class ScanExecutionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ScanExecutionError';
  }
}

/** Validate AWS credentials, run the Stronghold scan, and parse the JSON report. */
export async function runScan(config: ActionConfig): Promise<ScanResult> {
  try {
    await validateCredentials(config);
  } catch (error) {
    throw new ScanExecutionError(
      'AWS credential validation failed. Confirm your GitHub secrets are valid and the IAM policy allows read-only discovery.',
      error,
    );
  }

  const reportPath = path.join(config.workspaceRoot, '.stronghold', 'report.json');
  await mkdir(path.dirname(reportPath), { recursive: true });

  const env = buildCommandEnv(config);
  await executeCli(buildScanArgs(config), config.workspaceRoot, env, SCAN_TIMEOUT_MS);
  await executeCli(
    ['@stronghold-dr/cli', 'report', '--format', 'json', '--output', reportPath],
    config.workspaceRoot,
    env,
    REPORT_TIMEOUT_MS,
  );

  const raw = await readFile(reportPath, 'utf8');
  return parseReport(raw);
}

function buildScanArgs(config: ActionConfig): readonly string[] {
  const args = [
    '@stronghold-dr/cli',
    'scan',
    '--region',
    config.regions.join(','),
    '--output',
    'silent',
  ];
  return config.services.length > 0
    ? [...args, '--services', config.services.join(',')]
    : args;
}

function buildCommandEnv(config: ActionConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: config.awsAccessKeyId,
    AWS_SECRET_ACCESS_KEY: config.awsSecretAccessKey,
    ...(config.awsSessionToken ? { AWS_SESSION_TOKEN: config.awsSessionToken } : {}),
  };
}

async function executeCli(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  const result = await runCommand(args, cwd, env, timeoutMs);
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim().length > 0
      ? ' Check AWS permissions and Stronghold CLI availability.'
      : '';
    throw new ScanExecutionError(
      `Stronghold CLI command failed with exit code ${result.exitCode}.${reason}`,
    );
  }
}

function runCommand(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<CommandExecution> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
      cwd,
      env,
      stdio: 'pipe',
    });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(new ScanExecutionError('Unable to start the Stronghold CLI process.', error));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? 1, stderr });
    });
  });
}

function parseReport(raw: string): ScanResult {
  const report = JSON.parse(raw) as ReportFile;
  const failures = report.criticalFailures ?? [];

  return {
    score: report.scoreBreakdown?.overall ?? report.score ?? 0,
    grade: report.scoreBreakdown?.grade ?? 'F',
    criticalCount: failures.length,
    highCount: (report.results ?? []).filter(
      (result) => result.severity === 'high' && result.status === 'fail',
    ).length,
    totalChecks: report.totalChecks ?? 0,
    passed: report.passed ?? 0,
    failed: report.failed ?? 0,
    warnings: report.warnings ?? 0,
    categories: report.scoreBreakdown?.byCategory ?? {},
    topFailures: failures.slice(0, 5).map((failure) => ({
      ruleId: failure.ruleId ?? 'unknown_rule',
      nodeId: failure.nodeId ?? 'unknown_node',
      message: failure.message ?? 'No failure message returned.',
      impact: formatImpact(failure.weightBreakdown?.directDependentCount),
      severity: failure.severity ?? 'critical',
    })),
    failureIds: failures.map(
      (failure) =>
        `${failure.ruleId ?? 'unknown_rule'}:${failure.nodeId ?? 'unknown_node'}`,
    ),
  };
}

function formatImpact(directDependentCount: number | undefined): string {
  if (!directDependentCount || directDependentCount <= 0) {
    return '';
  }
  return `${directDependentCount} direct dependents`;
}
