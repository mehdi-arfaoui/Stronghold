import { useQuery } from '@tanstack/react-query';
import { financialApi } from '@/api/financial.api';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function RoiGlobalWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'roi-global'],
    queryFn: async () => (await financialApi.getSummary()).data,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const summary = query.data;
  const roi = summary.metrics.roiPercent;
  const currency = summary.currency || 'EUR';

  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <div>
        <p className="text-xs text-muted-foreground">ROI estimé</p>
        <p className="text-3xl font-bold">
          {roi != null && Number.isFinite(roi) ? `${roi.toFixed(1).replace('.', ',')}%` : 'N/A'}
        </p>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Risque annuel: {formatCurrency(summary.metrics.annualRisk, currency)}</p>
        <p>Économies: {formatCurrency(Math.max(0, summary.metrics.potentialSavings), currency)}</p>
      </div>
    </div>
  );
}
