import * as core from '@actions/core';
import * as github from '@actions/github';

export interface ActionConfig {
  readonly regions: readonly string[];
  readonly awsAccessKeyId: string;
  readonly awsSecretAccessKey: string;
  readonly awsSessionToken?: string;
  readonly services: readonly string[];
  readonly failOnScoreDrop: number;
  readonly failUnderScore: number;
  readonly commentOnPR: boolean;
  readonly baselineBranch: string;
  readonly comparisonBranch: string;
  readonly currentBranch: string;
  readonly githubToken?: string;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly sha: string;
  readonly runId: string;
  readonly workspaceRoot: string;
}

export class ActionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionConfigError';
  }
}

/** Parse and validate the GitHub Action inputs. */
export function parseConfig(): ActionConfig {
  const regions = splitCsvInput(core.getInput('aws-region', { required: true }));
  if (regions.length === 0) {
    throw new ActionConfigError('Input "aws-region" must contain at least one AWS region.');
  }

  const awsAccessKeyId = core.getInput('aws-access-key-id', { required: true });
  const awsSecretAccessKey = core.getInput('aws-secret-access-key', { required: true });
  const awsSessionToken = optionalInput('aws-session-token');
  const githubToken = optionalEnv('GITHUB_TOKEN');

  maskSecrets([awsAccessKeyId, awsSecretAccessKey, awsSessionToken, githubToken]);

  return {
    regions,
    awsAccessKeyId,
    awsSecretAccessKey,
    ...(awsSessionToken ? { awsSessionToken } : {}),
    services: splitCsvInput(core.getInput('services')),
    failOnScoreDrop: readNumberInput('fail-on-score-drop'),
    failUnderScore: readNumberInput('fail-under-score'),
    commentOnPR: readBooleanInput('comment-on-pr', true),
    baselineBranch: optionalInput('baseline-branch') ?? 'main',
    comparisonBranch: resolveComparisonBranch(),
    currentBranch: resolveCurrentBranch(),
    ...(githubToken ? { githubToken } : {}),
    repositoryOwner: github.context.repo.owner,
    repositoryName: github.context.repo.repo,
    sha: github.context.sha || optionalEnv('GITHUB_SHA') || 'local',
    runId: optionalEnv('GITHUB_RUN_ID') || `${Date.now()}`,
    workspaceRoot: process.cwd(),
  };
}

function splitCsvInput(value: string): readonly string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readNumberInput(name: string): number {
  const raw = core.getInput(name);
  const value = raw.length === 0 ? 0 : Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) {
    throw new ActionConfigError(`Input "${name}" must be a non-negative integer.`);
  }
  return value;
}

function readBooleanInput(name: string, fallback: boolean): boolean {
  const raw = core.getInput(name).trim().toLowerCase();
  if (raw.length === 0) {
    return fallback;
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw new ActionConfigError(`Input "${name}" must be "true" or "false".`);
}

function resolveComparisonBranch(): string {
  const pullRequest = github.context.payload.pull_request;
  return pullRequest?.base?.ref ?? optionalInput('baseline-branch') ?? 'main';
}

function resolveCurrentBranch(): string {
  const pullRequest = github.context.payload.pull_request;
  return pullRequest?.head?.ref ?? optionalEnv('GITHUB_REF_NAME') ?? 'local';
}

function optionalInput(name: string): string | undefined {
  const value = core.getInput(name).trim();
  return value.length > 0 ? value : undefined;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function maskSecrets(values: ReadonlyArray<string | undefined>): void {
  values
    .filter((value): value is string => Boolean(value))
    .forEach((value) => core.setSecret(value));
}
