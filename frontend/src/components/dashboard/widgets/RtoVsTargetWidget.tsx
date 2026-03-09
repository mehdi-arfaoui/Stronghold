import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { biaApi } from '@/api/bia.api';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

export function RtoVsTargetWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'rto-vs-target'],
    queryFn: async () => (await biaApi.getEntries()).data.entries,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const data = useMemo(() => {
    return (query.data || [])
      .map((entry) => {
        const target = entry.rtoSuggested ?? 0;
        const actual = entry.effectiveRto ?? entry.rto ?? target;
        return {
          service: (entry.serviceDisplayName || entry.serviceName).slice(0, 18),
          target: Math.max(0, target),
          actual: Math.max(0, actual),
          gap: Math.max(0, actual - target),
        };
      })
      .sort((left, right) => right.gap - left.gap)
      .slice(0, 6);
  }, [query.data]);

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">Aucune donnée RTO disponible</p>;
  }

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="service" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Bar dataKey="target" fill="#22c55e" name="Cible RTO" />
          <Bar dataKey="actual" fill="#f97316" name="RTO actuel" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
