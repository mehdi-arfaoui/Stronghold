import type { ActionConfig } from './config';
import type { Comparison } from './comparator';
import type { ScanResult } from './scanner';

const CATEGORY_ORDER = [
  'backup',
  'redundancy',
  'failover',
  'detection',
  'recovery',
  'replication',
] as const;

/** Render the Stronghold PR comment in Markdown. */
export function formatComment(
  scan: ScanResult,
  comparison: Comparison,
  config: ActionConfig,
): string {
  const lines: string[] = [];

  lines.push(`## ${gradeEmoji(scan.grade)} Stronghold DR Check`, '');
  lines.push(`**DR Posture Score: ${scan.score}/100 (Grade: ${scan.grade})**`, '');
  lines.push(renderDelta(comparison), '');
  lines.push('### Categories', '', '| Category | Score | Change |', '|----------|-------|--------|');

  categoryNames(scan.categories).forEach((category) => {
    const score = scan.categories[category] ?? 0;
    lines.push(renderCategoryRow(category, score, comparison.categoryChanges[category]));
  });
  lines.push('');

  if (scan.topFailures.length > 0) {
    lines.push('### Critical Issues', '');
    scan.topFailures.forEach((failure) => lines.push(...renderFailure(failure, comparison)));
  }

  if (comparison.resolvedFailures.length > 0) {
    lines.push('### Resolved Issues', '');
    comparison.resolvedFailures.forEach((failureId) => {
      lines.push(`- ✅ ~~${failureId}~~ — fixed`);
    });
    lines.push('');
  }

  lines.push('---', '');
  lines.push(`${scan.passed} passed · ${scan.failed} failed · ${scan.warnings} warnings · ${scan.totalChecks} total checks`, '');
  lines.push(
    `Scanned regions: \`${config.regions.join(', ')}\` · Services: \`${config.services.join(', ') || 'all'}\``,
    '',
  );
  lines.push('<sub>🔒 [Stronghold](https://github.com/mehdi-arfaoui/stronghold) — open-source DR automation | [Docs](https://github.com/mehdi-arfaoui/stronghold/blob/main/docs/getting-started.md)</sub>');

  return lines.join('\n');
}

function renderDelta(comparison: Comparison): string {
  if (!comparison.hasBaseline) {
    return '_First scan — no baseline to compare against._';
  }
  if (comparison.delta === 0) {
    return `_No score change from baseline (${comparison.baselineScore ?? comparison.currentScore})._`;
  }

  const arrow = comparison.delta > 0 ? '📈' : '📉';
  const sign = comparison.delta > 0 ? '+' : '';
  return `${arrow} Score change: **${sign}${comparison.delta}** (baseline: ${comparison.baselineScore ?? comparison.currentScore})`;
}

function categoryNames(categories: Readonly<Record<string, number>>): readonly string[] {
  const extras = Object.keys(categories).filter(
    (name) => !CATEGORY_ORDER.includes(name as (typeof CATEGORY_ORDER)[number]),
  );
  return [...CATEGORY_ORDER, ...extras];
}

function renderCategoryRow(
  category: string,
  score: number,
  change?: Comparison['categoryChanges'][string],
): string {
  const changeText = !change || change.delta === 0
    ? '—'
    : `${change.delta > 0 ? '✅' : '⚠️'} ${change.delta > 0 ? '+' : ''}${change.delta}`;
  return `| ${category} | ${buildBar(score)} ${score}/100 | ${changeText} |`;
}

function buildBar(score: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(score / 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

function renderFailure(
  failure: ScanResult['topFailures'][number],
  comparison: Comparison,
): readonly string[] {
  const failureId = `${failure.ruleId}:${failure.nodeId}`;
  const lines = [
    `- ❌ **${failure.ruleId}** — \`${failure.nodeId}\`${comparison.newFailures.includes(failureId) ? ' 🆕' : ''}`,
    `  ${failure.message}`,
  ];
  return failure.impact ? [...lines, `  _Impact: ${failure.impact}_`, ''] : [...lines, ''];
}

function gradeEmoji(grade: string): string {
  return {
    A: '🟢',
    B: '🔵',
    C: '🟡',
    D: '🟠',
    F: '🔴',
  }[grade] ?? '⚪';
}
