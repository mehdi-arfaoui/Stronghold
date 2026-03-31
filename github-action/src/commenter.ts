import { access } from 'node:fs/promises';
import path from 'node:path';

import * as github from '@actions/github';

import type { ActionConfig } from './config';

const COMMENT_MARKER = '<!-- stronghold-dr-check -->';
const CLOUDFORMATION_PATTERN = /(^|\/)(cloudformation|cfn|sam|templates?)\/|(^|\/)(template|sam-template|cloudformation)\.(json|ya?ml)$|\.(template|stack)\.(json|ya?ml)$/i;
const TERRAFORM_PATTERN = /\.(tf|tfvars|tfvars\.json)$/i;
const TERRAFORM_FILE_PATTERN = /(^|\/)(terraform\.lock\.hcl|terragrunt\.hcl)$/i;
const CDK_MANIFESTS = new Set(['cdk.json', 'cdk.context.json']);
const CDK_DIRECTORY_PATTERN = /(^|\/)(bin|lib|cdk|stacks?|infrastructure)\//i;
const CDK_FILE_PATTERN = /\.(ts|js|mts|cts|py|java|cs)$/i;

export class GitHubCommentError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'GitHubCommentError';
  }
}

/** Post or update the Stronghold PR comment identified by its marker. */
export async function postOrUpdateComment(
  body: string,
  config: ActionConfig,
): Promise<void> {
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) {
    return;
  }

  const octokit = createOctokit(config);
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: config.repositoryOwner,
    repo: config.repositoryName,
    issue_number: pullRequest.number,
    per_page: 100,
  });
  const markedBody = `${COMMENT_MARKER}\n${body}`;
  const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner: config.repositoryOwner,
      repo: config.repositoryName,
      comment_id: existing.id,
      body: markedBody,
    });
    return;
  }

  await octokit.rest.issues.createComment({
    owner: config.repositoryOwner,
    repo: config.repositoryName,
    issue_number: pullRequest.number,
    body: markedBody,
  });
}

/** Return the IaC files changed by the current pull request, or null when PR metadata is unavailable. */
export async function findChangedInfrastructureFiles(
  config: ActionConfig,
): Promise<readonly string[] | null> {
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest || !config.githubToken) {
    return null;
  }

  const octokit = createOctokit(config);
  const hasCdkManifest = await detectCdkManifest(config.workspaceRoot);
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: config.repositoryOwner,
    repo: config.repositoryName,
    pull_number: pullRequest.number,
    per_page: 100,
  });

  return files
    .map((file) => file.filename)
    .filter((filename): filename is string => Boolean(filename))
    .filter((filename) => isInfrastructureFile(filename, hasCdkManifest));
}

function createOctokit(config: ActionConfig): ReturnType<typeof github.getOctokit> {
  if (!config.githubToken) {
    throw new GitHubCommentError(
      'GITHUB_TOKEN is required for pull request file inspection and comment updates.',
    );
  }
  return github.getOctokit(config.githubToken);
}

async function detectCdkManifest(workspaceRoot: string): Promise<boolean> {
  const manifests = Array.from(CDK_MANIFESTS.values()).map((filename) =>
    path.join(workspaceRoot, filename),
  );
  const matches = await Promise.all(
    manifests.map((filename) =>
      access(filename)
        .then(() => true)
        .catch(() => false),
    ),
  );
  return matches.some(Boolean);
}

function isInfrastructureFile(filename: string, hasCdkManifest: boolean): boolean {
  const normalized = filename.replace(/\\/g, '/');
  if (TERRAFORM_PATTERN.test(normalized) || TERRAFORM_FILE_PATTERN.test(normalized)) {
    return true;
  }
  if (CLOUDFORMATION_PATTERN.test(normalized)) {
    return true;
  }
  if (CDK_MANIFESTS.has(normalized)) {
    return true;
  }
  return hasCdkManifest
    && CDK_DIRECTORY_PATTERN.test(normalized)
    && CDK_FILE_PATTERN.test(normalized);
}
