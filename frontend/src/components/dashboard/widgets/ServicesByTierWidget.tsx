import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { biaApi } from '@/api/bia.api';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

export function ServicesByTierWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'services-by-tier'],
    queryFn: async () => (await biaApi.getSummary()).data,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const tiers = query.data.tiers || [];
  const max = useMemo(() => Math.max(1, ...tiers.map((tier) => tier.serviceCount)), [tiers]);

  return (
    <div className="space-y-2">
      {tiers.map((tier) => (
        <div key={tier.tier} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span>{tier.label}</span>
            <span className="text-muted-foreground">{tier.serviceCount}</span>
          </div>
          <div className="h-2 rounded bg-muted">
            <div
              className="h-full rounded bg-primary"
              style={{ width: `${Math.max(4, (tier.serviceCount / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
      {tiers.length === 0 && <p className="text-xs text-muted-foreground">Aucune donnée BIA</p>}
    </div>
  );
}
