import { useQuery } from '@tanstack/react-query';
import { discoveryApi } from '@/api/discovery.api';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

export function LastScansWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'last-scans'],
    queryFn: async () => (await discoveryApi.getScanTimeline(6)).data.entries,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const entries = query.data;

  return (
    <div className="h-full overflow-auto pr-1">
      <div className="space-y-2">
        {entries.slice(0, 5).map((entry) => (
          <div key={entry.id} className="rounded border px-2 py-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {entry.type === 'scheduled' ? 'Planifié' : 'Manuel'}
              </span>
              <span className="text-muted-foreground">
                {new Date(entry.occurredAt).toLocaleDateString('fr-FR')}
              </span>
            </div>
            <p className="text-muted-foreground">
              {entry.nodes} nœuds, {entry.spofCount} SPOF, {entry.driftCount} drift(s)
            </p>
          </div>
        ))}
        {entries.length === 0 && <p className="text-xs text-muted-foreground">Aucun scan historisé</p>}
      </div>
    </div>
  );
}
