import type { ApiHistoryTrendResponse } from '@stronghold-dr/core';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { themeColor } from '@/lib/utils';

export function PostureTrendChart({
  historyTrend,
}: {
  readonly historyTrend: ApiHistoryTrendResponse | null;
}): JSX.Element {
  const points = (historyTrend?.snapshots ?? []).map((snapshot) => ({
    label: snapshot.timestamp.slice(5, 10),
    timestamp: snapshot.timestamp,
    score: snapshot.globalScore,
    findings: snapshot.totalFindings,
    coverage:
      snapshot.scenarioCoverage.total === 0
        ? 0
        : Math.round((snapshot.scenarioCoverage.covered / snapshot.scenarioCoverage.total) * 100),
  }));

  return (
    <section className="panel h-[360px] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Posture trend</p>
          <h3 className="mt-2 text-2xl font-semibold text-foreground">Score and scenario coverage</h3>
        </div>
        <div className="rounded-full border border-border bg-card/70 px-4 py-2 text-sm text-muted-foreground">
          {(historyTrend?.trend.global.direction ?? 'stable').replace('_', ' ')}
        </div>
      </div>

      {points.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Run more than one completed scan to unlock the posture trend timeline.
        </div>
      ) : (
        <div className="mt-6 h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ left: 4, right: 12, top: 12, bottom: 8 }}>
              <CartesianGrid stroke={themeColor('border', 0.5)} strokeDasharray="4 4" />
              <XAxis dataKey="label" tick={{ fill: themeColor('muted-foreground'), fontSize: 12 }} />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: themeColor('muted-foreground'), fontSize: 12 }}
                width={36}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: themeColor('overlay', 0.96),
                  borderColor: themeColor('border'),
                  borderRadius: 16,
                  color: themeColor('foreground'),
                  boxShadow: 'var(--panel-shadow)',
                }}
                formatter={(value: number, key: string) => {
                  if (key === 'coverage') {
                    return [`${value}%`, 'Scenario coverage'];
                  }
                  if (key === 'findings') {
                    return [value, 'Findings'];
                  }
                  return [value, 'Score'];
                }}
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as
                    | { readonly timestamp?: string; readonly findings?: number }
                    | undefined;
                  if (!point?.timestamp) {
                    return '';
                  }
                  return `${point.timestamp.slice(0, 10)} • ${point.findings ?? 0} findings`;
                }}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#38bdf8"
                strokeWidth={3}
                dot={{ r: 3, fill: '#38bdf8' }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="coverage"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 2, fill: '#f59e0b' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-4 text-xs uppercase tracking-[0.14em] text-subtle-foreground">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
          Score
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          Scenario coverage
        </div>
      </div>
    </section>
  );
}
