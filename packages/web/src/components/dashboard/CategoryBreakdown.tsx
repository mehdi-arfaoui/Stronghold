import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { DR_CATEGORY_COLORS } from '@/lib/constants';
import { themeColor } from '@/lib/utils';

export function CategoryBreakdown({
  categories,
}: {
  readonly categories: Record<string, number> | null;
}): JSX.Element {
  const entries = Object.entries(categories ?? {}).map(([key, value]) => ({
    name: key,
    value: Math.round(value),
    color: DR_CATEGORY_COLORS[key] ?? '#94a3b8',
  }));

  return (
    <section className="panel h-[320px] p-6">
      <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Category breakdown</p>
      {entries.length === 0 ? (
        <div className="mt-8 text-sm text-muted-foreground">Category scores will appear after a completed validation run.</div>
      ) : (
        <div className="mt-4 h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={entries} layout="vertical" margin={{ left: 12, right: 12 }}>
              <XAxis type="number" domain={[0, 100]} tick={{ fill: themeColor('subtle-foreground'), fontSize: 12 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: themeColor('muted-foreground'), fontSize: 12 }} width={92} />
              <Tooltip
                cursor={{ fill: themeColor('accent', 0.08) }}
                contentStyle={{
                  backgroundColor: themeColor('overlay', 0.96),
                  borderColor: themeColor('border'),
                  borderRadius: 16,
                  color: themeColor('foreground'),
                  boxShadow: 'var(--panel-shadow)',
                }}
              />
              <Bar dataKey="value" radius={[0, 10, 10, 0]}>
                {entries.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
