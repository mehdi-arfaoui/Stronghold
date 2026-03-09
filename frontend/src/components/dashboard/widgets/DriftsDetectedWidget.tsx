import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { driftApi } from '@/api/drift.api';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function DriftsDetectedWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'drifts-detected'],
    queryFn: async () => (await driftApi.getEvents({ status: 'open', limit: 20 })).data,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const events = query.data.events || [];
  const mostSevere = useMemo(() => {
    return [...events].sort(
      (left, right) => (SEVERITY_RANK[right.severity] || 0) - (SEVERITY_RANK[left.severity] || 0),
    )[0];
  }, [events]);

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div>
        <p className="text-2xl font-semibold">{events.length}</p>
        <p className="text-xs text-muted-foreground">drift(s) ouvert(s)</p>
      </div>
      {mostSevere ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
          <div className="mb-1 flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Priorité {mostSevere.severity}</span>
          </div>
          <p className="line-clamp-2">{mostSevere.description}</p>
        </div>
      ) : (
        <div className="rounded-md border border-emerald-300 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-900">
          Aucun drift critique détecté
        </div>
      )}
    </div>
  );
}
