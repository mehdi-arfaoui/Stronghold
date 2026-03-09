import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { analysisApi } from '@/api/analysis.api';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

export function SpofCountWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'spof-count'],
    queryFn: async () => (await analysisApi.getSPOFs()).data,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const spofs = Array.isArray(query.data) ? query.data : [];
  const critical = spofs.filter((item) => item.severity === 'critical').length;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between rounded-md bg-red-500/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          <span className="text-xs text-muted-foreground">Total SPOF</span>
        </div>
        <span className="text-xl font-semibold">{spofs.length}</span>
      </div>
      <div className="text-xs text-muted-foreground">{critical} critique(s)</div>
      <div className="space-y-1.5 overflow-auto pr-1">
        {spofs.slice(0, 3).map((item) => (
          <div key={item.nodeId} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
            <span className="truncate text-xs">{item.nodeName}</span>
            <SeverityBadge severity={item.severity} />
          </div>
        ))}
        {spofs.length === 0 && <p className="text-xs text-muted-foreground">Aucun SPOF détecté</p>}
      </div>
    </div>
  );
}
