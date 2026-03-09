import { useQuery } from '@tanstack/react-query';
import { analysisApi } from '@/api/analysis.api';
import { ResilienceGauge } from '@/components/dashboard/ResilienceGauge';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

export function ResilienceScoreWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'resilience-score'],
    queryFn: async () => (await analysisApi.getResilienceScore()).data,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const score = Math.max(0, Math.min(100, query.data.overall ?? 0));
  const topBreakdown = (query.data.breakdown || []).slice(0, 3);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex justify-center">
        <ResilienceGauge score={score} size={125} />
      </div>
      <div className="space-y-1.5 text-xs">
        {topBreakdown.map((item) => (
          <div key={item.category} className="flex items-center justify-between">
            <span className="truncate text-muted-foreground">{item.label}</span>
            <span className={item.impact < 0 ? 'text-red-500' : 'text-emerald-500'}>
              {item.impact > 0 ? '+' : ''}
              {item.impact}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
