import type { ValidationReport } from '@stronghold-dr/core';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { DR_CATEGORY_COLORS } from '@/lib/constants';
import { themeColor } from '@/lib/utils';

export function ScoreBreakdown({
  report,
  filteredCount,
}: {
  readonly report: ValidationReport;
  readonly filteredCount: number;
}): JSX.Element {
  const categoryData = Object.entries(report.scoreBreakdown.byCategory).map(([name, value]) => ({
    name,
    value: Math.round(value),
    color: DR_CATEGORY_COLORS[name] ?? '#94a3b8',
  }));

  return (
    <section className="panel p-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Validation score</p>
          <div className="mt-3 flex items-end gap-4">
            <span className="text-5xl font-semibold text-foreground">{Math.round(report.scoreBreakdown.overall)}</span>
            <span className="rounded-full bg-accent-soft px-4 py-1 text-xl font-semibold text-accent-soft-foreground">
              {report.scoreBreakdown.grade}
            </span>
          </div>
          <p className="mt-4 max-w-2xl text-sm text-muted-foreground">{report.scoreBreakdown.disclaimer}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-subtle-foreground">
            Showing {filteredCount} of {report.results.length} results
          </p>
        </div>
        <div className="grid min-w-[220px] gap-3 rounded-2xl border border-border bg-elevated p-4 text-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Passed</span>
            <span className="text-foreground">{report.passed}</span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Failed</span>
            <span className="text-foreground">{report.failed}</span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Warnings</span>
            <span className="text-foreground">{report.warnings}</span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Weakest category</span>
            <span className="text-foreground">{report.scoreBreakdown.weakestCategory}</span>
          </div>
        </div>
      </div>
      <div className="mt-6 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={categoryData}>
            <XAxis dataKey="name" tick={{ fill: themeColor('subtle-foreground'), fontSize: 12 }} />
            <YAxis tick={{ fill: themeColor('muted-foreground'), fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: themeColor('overlay', 0.96),
                borderColor: themeColor('border'),
                borderRadius: 16,
                color: themeColor('foreground'),
                boxShadow: 'var(--panel-shadow)',
              }}
            />
            <Bar dataKey="value" radius={[10, 10, 0, 0]}>
              {categoryData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
