import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { recommendationsApi } from '@/api/recommendations.api';
import { Progress } from '@/components/ui/progress';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

function formatAmount(value: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function BudgetDrWidget() {
  const query = useQuery({
    queryKey: ['dashboard-widget', 'budget-dr'],
    queryFn: async () => (await recommendationsApi.getSummary()).data,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const summary = query.data;
  const currency = summary.currency || 'EUR';
  const annualCost = summary.selectedAnnualCost ?? summary.totalAnnualCost ?? 0;
  const annualBudget = summary.budgetAnnual ?? 0;

  const usage = useMemo(() => {
    if (annualBudget <= 0) return 0;
    return Math.max(0, Math.min(100, (annualCost / annualBudget) * 100));
  }, [annualBudget, annualCost]);

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div>
        <p className="text-xl font-semibold">{formatAmount(annualCost, currency)}</p>
        <p className="text-xs text-muted-foreground">Coût DR annuel estimé</p>
      </div>

      <div className="space-y-2">
        <Progress value={usage} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Budget: {annualBudget > 0 ? formatAmount(annualBudget, currency) : 'Non défini'}</span>
          <span>{annualBudget > 0 ? `${usage.toFixed(0)}%` : 'N/A'}</span>
        </div>
      </div>
    </div>
  );
}
