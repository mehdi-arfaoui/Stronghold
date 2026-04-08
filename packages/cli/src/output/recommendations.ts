import type { Recommendation, ServiceRecommendationProjection } from '@stronghold-dr/core';

const RISK_LABELS: Readonly<Record<Recommendation['risk'], string>> = {
  safe: 'SAFE',
  caution: 'CAUTION',
  dangerous: 'DANGEROUS',
};

export function renderRecommendationHighlights(
  recommendations: ReadonlyArray<Recommendation | ServiceRecommendationProjection>,
  currentScore: number,
  detailsCommand = 'stronghold report',
  totalCount = recommendations.length,
): string {
  if (recommendations.length === 0) {
    return '';
  }

  const lines = ['Top Recommendations', ''];
  let runningScore = currentScore;

  recommendations.forEach((recommendation, index) => {
    const isServiceRecommendation = hasProjectedScore(recommendation);
    const current = isServiceRecommendation
      ? recommendation.projectedScore.current
      : runningScore;
    const nextScore = isServiceRecommendation
      ? recommendation.projectedScore.next
      : Math.min(100, runningScore + recommendation.impact.scoreDelta);
    lines.push(
      `${index + 1}. [${RISK_LABELS[recommendation.risk]}] ${recommendation.title}${isServiceRecommendation && recommendation.serviceName ? ` (service: ${recommendation.serviceName})` : ''}`,
    );
    if (isServiceRecommendation && recommendation.drImpactSummary) {
      lines.push(`   DR impact: ${recommendation.drImpactSummary}`);
    }
    lines.push(
      buildImpactLine(recommendation, current, nextScore, runningScore),
    );
    lines.push(`   Command: ${recommendation.remediation.command}`);
    lines.push(`   ${renderRecommendationNote(recommendation)}`);
    lines.push('');
    if (!isServiceRecommendation && typeof nextScore === 'number') {
      runningScore = nextScore;
    }
  });

  lines.push(
    `Run '${detailsCommand}' for the full list of ${totalCount} recommendation${totalCount === 1 ? '' : 's'}.`,
  );
  return lines.join('\n');
}

export function renderRecommendationSection(
  recommendations: ReadonlyArray<Recommendation | ServiceRecommendationProjection>,
  currentScore: number,
  format: 'terminal' | 'markdown',
): string {
  if (recommendations.length === 0) {
    return format === 'markdown'
      ? '## Recommendations\n\nNo recommendations.'
      : '\nRecommendations\nNo recommendations.';
  }

  const safeRecommendations = recommendations.filter((item) => item.risk === 'safe');
  const safeScore = projectScore(currentScore, safeRecommendations as readonly Recommendation[]);
  if (format === 'markdown') {
    const lines = ['## Recommendations', ''];
    lines.push(
      `Implementing all safe recommendations would improve your score from ${currentScore} to ${safeScore} (+${safeScore - currentScore}).`,
    );
    lines.push('');
    lines.push(...renderRecommendationGroupMarkdown('Safe', safeRecommendations));
    lines.push('');
    lines.push(
      ...renderRecommendationGroupMarkdown(
        'Caution',
        recommendations.filter((item) => item.risk === 'caution'),
      ),
    );
    lines.push('');
    lines.push(
      ...renderRecommendationGroupMarkdown(
        'Dangerous',
        recommendations.filter((item) => item.risk === 'dangerous'),
      ),
    );
    return lines.join('\n');
  }

  const lines = ['Recommendations', ''];
  lines.push(
    `Implementing all safe recommendations would improve your score from ${currentScore} to ${safeScore} (+${safeScore - currentScore}).`,
  );
  lines.push('');
  lines.push(...renderRecommendationGroupTerminal('SAFE', safeRecommendations));
  lines.push('');
  lines.push(
    ...renderRecommendationGroupTerminal(
      'CAUTION',
      recommendations.filter((item) => item.risk === 'caution'),
    ),
  );
  lines.push('');
  lines.push(
    ...renderRecommendationGroupTerminal(
      'DANGEROUS',
      recommendations.filter((item) => item.risk === 'dangerous'),
    ),
  );
  return lines.join('\n');
}

export function projectScore(
  currentScore: number,
  recommendations: readonly Recommendation[],
): number {
  return recommendations.reduce(
    (score, recommendation) => Math.min(100, score + recommendation.impact.scoreDelta),
    currentScore,
  );
}

function renderRecommendationGroupTerminal(
  label: string,
  recommendations: ReadonlyArray<Recommendation | ServiceRecommendationProjection>,
): readonly string[] {
  const lines = [`${label}`];
  if (recommendations.length === 0) {
    lines.push('No recommendations.');
    return lines;
  }

  recommendations.forEach((recommendation, index) => {
    lines.push(
      `${index + 1}. [${RISK_LABELS[recommendation.risk]}] ${recommendation.title}${hasProjectedScore(recommendation) && recommendation.serviceName ? ` (service: ${recommendation.serviceName})` : ''} (+${recommendation.impact.scoreDelta})`,
    );
    lines.push(`   Why: ${recommendation.description}`);
    if (hasProjectedScore(recommendation) && recommendation.drImpactSummary) {
      lines.push(`   DR impact: ${recommendation.drImpactSummary}`);
    }
    lines.push(`   Command: ${recommendation.remediation.command}`);
    lines.push(`   Note: ${renderRecommendationNote(recommendation)}`);
    if (recommendation.risk === 'dangerous') {
      lines.push(
        '   Warning: This action may cause downtime. Test in a non-production environment first.',
      );
    }
    lines.push('');
  });

  return lines;
}

function renderRecommendationGroupMarkdown(
  label: string,
  recommendations: ReadonlyArray<Recommendation | ServiceRecommendationProjection>,
): readonly string[] {
  const lines = [`### ${label}`, ''];
  if (recommendations.length === 0) {
    lines.push('No recommendations.');
    return lines;
  }

  recommendations.forEach((recommendation) => {
    lines.push(
      `- **[${RISK_LABELS[recommendation.risk]}] ${recommendation.title}${hasProjectedScore(recommendation) && recommendation.serviceName ? ` (service: ${recommendation.serviceName})` : ''}** (+${recommendation.impact.scoreDelta})`,
    );
    lines.push(`- Why: ${recommendation.description}`);
    if (hasProjectedScore(recommendation) && recommendation.drImpactSummary) {
      lines.push(`- DR impact: ${recommendation.drImpactSummary}`);
    }
    lines.push(`- Command: \`${recommendation.remediation.command}\``);
    lines.push(`- Note: ${renderRecommendationNote(recommendation)}`);
    if (recommendation.risk === 'dangerous') {
      lines.push(
        '- Warning: This action may cause downtime. Test in a non-production environment first.',
      );
    }
    lines.push('');
  });

  return lines;
}

function renderRecommendationNote(recommendation: Recommendation): string {
  if (recommendation.risk === 'dangerous') {
    return recommendation.riskReason;
  }
  if (recommendation.remediation.requiresDowntime) {
    return 'Downtime or a brief failover is possible. Schedule during a maintenance window.';
  }
  if (recommendation.remediation.requiresMaintenanceWindow) {
    return 'No downtime is expected, but this should still be planned and reviewed before execution.';
  }
  return 'No downtime is expected. Safe to apply through your normal change process.';
}

function hasProjectedScore(
  recommendation: Recommendation | ServiceRecommendationProjection,
): recommendation is ServiceRecommendationProjection {
  return 'projectedScore' in recommendation;
}

function buildImpactLine(
  recommendation: Recommendation | ServiceRecommendationProjection,
  current: number | null | undefined,
  nextScore: number | null | undefined,
  fallbackCurrent: number,
): string {
  if (typeof current === 'number' && typeof nextScore === 'number') {
    const currentGrade = hasProjectedScore(recommendation)
      ? recommendation.projectedScore.currentGrade
      : null;
    const nextGrade = hasProjectedScore(recommendation)
      ? recommendation.projectedScore.nextGrade
      : null;
    const label = hasProjectedScore(recommendation)
      ? recommendation.serviceName ?? 'service'
      : 'DR';
    return `   Impact: ${label} score +${nextScore - current} (${current} -> ${nextScore})${currentGrade && nextGrade ? `, grade ${currentGrade} -> ${nextGrade}` : ''}`;
  }

  const projected = Math.min(100, fallbackCurrent + recommendation.impact.scoreDelta);
  return `   Impact: DR score +${projected - fallbackCurrent} (${fallbackCurrent} -> ${projected})  |  Category: ${recommendation.category}`;
}
