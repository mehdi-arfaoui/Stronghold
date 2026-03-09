import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { biaApi } from '@/api/bia.api';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

export function TopCriticalServicesWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'top-critical-services'],
    queryFn: async () => (await biaApi.getEntries()).data,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const entries = query.data.entries || [];
  const topEntries = useMemo(
    () =>
      [...entries]
        .sort((left, right) => {
          const leftTier = Number.isFinite(left.tier) ? left.tier : 4;
          const rightTier = Number.isFinite(right.tier) ? right.tier : 4;
          if (leftTier !== rightTier) return leftTier - rightTier;

          return (right.financialImpactPerHour ?? 0) - (left.financialImpactPerHour ?? 0);
        })
        .slice(0, 5),
    [entries],
  );

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="pb-2 text-left font-medium">Service</th>
            <th className="pb-2 text-left font-medium">Tier</th>
            <th className="pb-2 text-left font-medium">RTO</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {topEntries.map((entry) => (
            <tr key={entry.id}>
              <td className="py-2 pr-2">
                <span className="line-clamp-1">{entry.serviceDisplayName || entry.serviceName}</span>
              </td>
              <td className="py-2">T{entry.tier}</td>
              <td className="py-2">{entry.effectiveRto ?? entry.rtoSuggested} min</td>
            </tr>
          ))}
          {topEntries.length === 0 && (
            <tr>
              <td className="py-3 text-muted-foreground" colSpan={3}>
                Aucune donnée BIA disponible
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
