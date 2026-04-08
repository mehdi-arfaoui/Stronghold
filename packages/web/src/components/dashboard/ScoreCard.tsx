import type { ScenarioCoverageSummary } from '@stronghold-dr/core';

import { getGradeColor } from '@/lib/utils';

export function ScoreCard({
  score,
  grade,
  createdAt,
  scenarioSummary,
}: {
  readonly score: number | null;
  readonly grade: string | null;
  readonly createdAt?: string;
  readonly scenarioSummary?: ScenarioCoverageSummary | null;
}): JSX.Element {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score ?? 0)));

  return (
    <section className="panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Latest DR score</p>
          <div className="mt-3 text-5xl font-semibold text-foreground">{score == null ? 'N/A' : clampedScore}</div>
        </div>
        <div
          className="rounded-full px-4 py-2 text-xl font-semibold text-white shadow-sm"
          style={{ backgroundColor: getGradeColor(grade) }}
        >
          {grade ?? 'N/A'}
        </div>
      </div>
      <div className="mt-6 h-3 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-150"
          style={{
            width: `${clampedScore}%`,
            backgroundColor: getGradeColor(grade),
          }}
        />
      </div>
      {scenarioSummary && scenarioSummary.total > 0 ? (
        <div className="mt-5 rounded-2xl border border-border bg-elevated p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Scenario coverage</p>
          <div className="mt-2 text-2xl font-semibold text-foreground">
            {scenarioSummary.covered}/{scenarioSummary.total}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            scenarios covered, with {scenarioSummary.uncovered} uncovered and {scenarioSummary.degraded} degraded.
          </p>
        </div>
      ) : null}
      <p className="mt-4 text-sm text-muted-foreground">
        {createdAt
          ? `Based on scan completed ${new Date(createdAt).toLocaleString()}.`
          : 'Run a completed scan to populate this card.'}
      </p>
    </section>
  );
}
