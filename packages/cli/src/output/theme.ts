import chalk from 'chalk';

import type { ValidationReport, WeightedValidationResult } from '@stronghold-dr/core';

export const theme = {
  section: chalk.bold,
  command: chalk.cyan,
  pass: chalk.green,
  fail: chalk.red,
  warn: chalk.yellow,
  skip: chalk.gray,
  dim: chalk.dim,
  demo: chalk.magenta,
  barFilled: chalk.cyan,
  barEmpty: chalk.gray,
};

export function formatReadOnlyMessage(): string {
  return theme.dim('🔒 Read-only scan — no changes will be made to your infrastructure.');
}

export function formatDemoMessage(): string {
  return theme.demo('🎭 Demo mode — using built-in sample infrastructure (no AWS credentials needed)');
}

export function formatGrade(report: ValidationReport): string {
  const label = `${report.scoreBreakdown.overall}/100 (Grade: ${report.scoreBreakdown.grade})`;
  if (report.scoreBreakdown.grade === 'A' || report.scoreBreakdown.grade === 'B') {
    return theme.pass(label);
  }
  if (report.scoreBreakdown.grade === 'C') {
    return theme.warn(label);
  }
  return theme.fail(label);
}

export function formatSeverityLabel(result: WeightedValidationResult): string {
  if (result.severity === 'critical') {
    return theme.fail('critical');
  }
  if (result.severity === 'high') {
    return theme.warn('high');
  }
  return theme.skip(result.severity);
}

export function buildAsciiBar(score: number): string {
  const filled = Math.max(0, Math.min(20, Math.round(score / 5)));
  return `${theme.barFilled('█'.repeat(filled))}${theme.barEmpty('░'.repeat(20 - filled))}`;
}
