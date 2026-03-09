import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { recommendationsApi } from '@/api/recommendations.api';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

const STRATEGY_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function CostByStrategyWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'cost-dr-by-strategy'],
    queryFn: async () => (await recommendationsApi.getSummary()).data,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const summary = query.data;
  const currency = summary.currency || 'EUR';
  const data = useMemo(() => {
    const source = Object.entries(summary.annualCostByStrategy || {});
    if (source.length > 0) {
      return source
        .map(([name, value]) => ({ name, value: Number(value) || 0 }))
        .filter((entry) => entry.value > 0);
    }

    return Object.entries(summary.byStrategy || {})
      .map(([name, value]) => ({ name, value: Number(value) || 0 }))
      .filter((entry) => entry.value > 0);
  }, [summary.annualCostByStrategy, summary.byStrategy]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="h-[170px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={38} outerRadius={68}>
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={STRATEGY_COLORS[index % STRATEGY_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => formatCurrency(Number(value), currency)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1 overflow-auto text-xs">
        {data.slice(0, 4).map((entry, index) => (
          <div key={entry.name} className="flex items-center justify-between gap-2">
            <span className="truncate" style={{ color: STRATEGY_COLORS[index % STRATEGY_COLORS.length] }}>
              {entry.name}
            </span>
            <span className="text-muted-foreground">{formatCurrency(entry.value, currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
