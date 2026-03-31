import * as core from '@actions/core';
import * as github from '@actions/github';

import { findChangedInfrastructureFiles, postOrUpdateComment } from './commenter';
import { compareWithBaseline } from './comparator';
import type { ActionConfig } from './config';
import { parseConfig } from './config';
import { formatComment } from './formatter';
import { runScan } from './scanner';

/** GitHub Action entry point. */
async function run(): Promise<void> {
  try {
    const config = parseConfig();
    const changedFiles = await findChangedInfrastructureFiles(config);
    if (shouldSkipScan(changedFiles)) {
      handleSkippedRun();
      return;
    }

    if (changedFiles) {
      core.info(`Detected ${changedFiles.length} infrastructure file(s) in this pull request.`);
    }

    core.info(`Scanning AWS infrastructure in ${config.regions.join(', ')}...`);
    const scanResult = await runScan(config);
    const comparison = await compareWithBaseline(scanResult, config);
    const comment = formatComment(scanResult, comparison, config);

    if (config.commentOnPR && github.context.payload.pull_request) {
      await postOrUpdateComment(comment, config);
    }

    const status = resolveStatus(scanResult.score, comparison.delta, config);
    setOutputs(scanResult.score, scanResult.grade, comparison.delta, scanResult.criticalCount, status);
    if (status === 'fail') {
      core.setFailed(buildFailureMessage(scanResult.score, comparison.delta, config));
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Stronghold DR Check failed.');
  }
}

function shouldSkipScan(changedFiles: readonly string[] | null): boolean {
  return Array.isArray(changedFiles) && changedFiles.length === 0;
}

function handleSkippedRun(): void {
  core.notice('Skipping Stronghold DR Check because no Terraform, CloudFormation, or CDK files changed in this pull request.');
  setOutputs('', '', '', '', 'pass');
}

function resolveStatus(score: number, delta: number, config: ActionConfig): 'pass' | 'fail' {
  if (config.failUnderScore > 0 && score < config.failUnderScore) {
    return 'fail';
  }
  return config.failOnScoreDrop > 0 && delta < -config.failOnScoreDrop ? 'fail' : 'pass';
}

function buildFailureMessage(score: number, delta: number, config: ActionConfig): string {
  const reasons: string[] = [];
  if (config.failUnderScore > 0 && score < config.failUnderScore) {
    reasons.push(`DR score ${score} is below threshold ${config.failUnderScore}.`);
  }
  if (config.failOnScoreDrop > 0 && delta < -config.failOnScoreDrop) {
    reasons.push(`DR score dropped by ${Math.abs(delta)} (threshold: ${config.failOnScoreDrop}).`);
  }
  return reasons.join(' ');
}

function setOutputs(
  score: number | string,
  grade: string,
  delta: number | string,
  criticalCount: number | string,
  status: 'pass' | 'fail',
): void {
  core.setOutput('score', score);
  core.setOutput('grade', grade);
  core.setOutput('score-delta', delta);
  core.setOutput('critical-count', criticalCount);
  core.setOutput('status', status);
}

void run();
