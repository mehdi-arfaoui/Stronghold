import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { discoveryApi } from '@/api/discovery.api';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

const PROVIDER_COLORS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#64748b'];

export function ServicesByProviderWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'services-by-provider'],
    queryFn: async () => (await discoveryApi.getGraph()).data,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of query.data.nodes || []) {
      const provider = String(node.provider || 'unknown').toLowerCase();
      counts.set(provider, (counts.get(provider) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [query.data.nodes]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="h-[170px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={38} outerRadius={68}>
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={PROVIDER_COLORS[index % PROVIDER_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1 overflow-auto text-xs">
        {data.slice(0, 4).map((entry, index) => (
          <div key={entry.name} className="flex items-center justify-between gap-2">
            <span className="truncate" style={{ color: PROVIDER_COLORS[index % PROVIDER_COLORS.length] }}>
              {entry.name.toUpperCase()}
            </span>
            <span className="text-muted-foreground">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
