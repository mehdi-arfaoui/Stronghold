import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check,
  Clock,
  DollarSign,
  Lightbulb,
  Loader2,
  TrendingUp,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { recommendationsApi, type Recommendation } from '@/api/recommendations.api';
import { financialApi } from '@/api/financial.api';
import { getCredentialScopeKey } from '@/lib/credentialStorage';

const CURRENCIES = [
  { code: 'EUR', symbol: '\u20AC' },
  { code: 'USD', symbol: '$' },
  { code: 'GBP', symbol: '\u00A3' },
  { code: 'CHF', symbol: 'CHF ' },
] as const;

const STRATEGY_LABELS: Record<string, string> = {
  'active-active': 'Active-Active',
  'warm-standby': 'Warm Standby',
  'pilot-light': 'Pilot Light',
  backup: 'Backup & Restore',
};

function normalizeStrategy(strategy?: Recommendation['strategy']): string | undefined {
  if (!strategy) return undefined;
  if (strategy === 'backup') return 'backup_restore';
  return strategy.replace(/-/g, '_');
}

function money(amount: number, currencySymbol: string): string {
  if (!Number.isFinite(amount) || amount <= 0) return `${currencySymbol}0`;
  if (amount >= 1_000_000) return `${currencySymbol}${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${currencySymbol}${Math.round(amount / 1_000)}K`;
  return `${currencySymbol}${Math.round(amount)}`;
}

function priorityWeight(priority: Recommendation['priority']): number {
  if (typeof priority === 'number') return priority;
  if (priority === 'P0') return 0;
  if (priority === 'P1') return 1;
  if (priority === 'P2') return 2;
  return 3;
}

interface RecommendationsEngineProps {
  className?: string;
}

export function RecommendationsEngine({ className }: RecommendationsEngineProps) {
  const queryClient = useQueryClient();
  const tenantScope = getCredentialScopeKey();
  const [currency, setCurrency] = useState<string>('EUR');
  const [localStatuses, setLocalStatuses] = useState<Record<string, boolean | null>>({});

  const currencyMeta = CURRENCIES.find((item) => item.code === currency) ?? CURRENCIES[0];

  const recommendationsQuery = useQuery({
    queryKey: ['recommendations'],
    queryFn: async () => (await recommendationsApi.getAll()).data,
  });

  const recommendations = useMemo(
    () =>
      [...(recommendationsQuery.data ?? [])].sort(
        (left, right) => priorityWeight(left.priority) - priorityWeight(right.priority),
      ),
    [recommendationsQuery.data],
  );

  const roiPayloadDigest = useMemo(
    () =>
      recommendations
        .map((recommendation) => `${recommendation.id}:${recommendation.estimatedCost ?? 0}:${recommendation.strategy ?? 'default'}`)
        .join('|'),
    [recommendations],
  );

  const roiQuery = useQuery({
    queryKey: ['financial-recommendations-roi', tenantScope, currency, roiPayloadDigest],
    enabled: recommendations.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      (
        await financialApi.calculateROI({
          currency,
          recommendations: recommendations.map((recommendation) => ({
            recommendationId: recommendation.id,
            strategy: normalizeStrategy(recommendation.strategy),
            targetNodes: recommendation.nodeId
              ? [recommendation.nodeId]
              : recommendation.affectedNodeIds ?? [],
            monthlyCost: recommendation.estimatedCost ?? undefined,
          })),
        })
      ).data,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, accepted }: { id: string; accepted: boolean }) =>
      recommendationsApi.updateStatus(id, { accepted }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['financial-recommendations-roi'] });
    },
    onError: () => {
      toast.error('Mise a jour de statut impossible');
    },
  });

  const breakdownByRecommendationId = useMemo(() => {
    const breakdown = roiQuery.data?.breakdownByRecommendation ?? [];
    return new Map(breakdown.map((entry) => [entry.recommendationId, entry]));
  }, [roiQuery.data]);

  const setRecommendationStatus = (recommendation: Recommendation, accepted: boolean) => {
    setLocalStatuses((previous) => ({ ...previous, [recommendation.id]: accepted }));
    updateMutation.mutate({ id: recommendation.id, accepted });
    toast.success(accepted ? 'Recommandation integree au plan' : 'Recommandation rejetee');
  };

  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recommandations IA</h2>
        </div>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger className="w-[110px]" aria-label="Devise">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {item.code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {roiQuery.isLoading && (
        <Card>
          <CardContent className="py-8 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </CardContent>
        </Card>
      )}

      {roiQuery.data && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              ROI de vos recommandations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Metric label="Risque annuel actuel (ALE)" value={money(roiQuery.data.currentALE, currencyMeta.symbol)} color="text-red-600" />
              <Metric label="Risque annuel projete" value={money(roiQuery.data.projectedALE, currencyMeta.symbol)} color="text-green-600" />
              <Metric label="Cout remediation annuel" value={money(roiQuery.data.annualRemediationCost, currencyMeta.symbol)} />
              <Metric label="Payback" value={`${roiQuery.data.paybackMonths} mois`} />
            </div>

            <div className="rounded-lg border bg-muted/20 p-4 space-y-1">
              <p>Reduction de risque estimee: <span className="font-semibold">{money(roiQuery.data.riskReductionAmount, currencyMeta.symbol)}</span> ({roiQuery.data.riskReduction}%)</p>
              <p>ROI net annuel: <span className={cn('font-semibold', roiQuery.data.netAnnualSavings >= 0 ? 'text-green-600' : 'text-red-600')}>{money(roiQuery.data.netAnnualSavings, currencyMeta.symbol)}</span></p>
              <p>ROI: <span className="font-semibold">{roiQuery.data.roiPercent}%</span></p>
              <p className="text-xs text-muted-foreground mt-2">{roiQuery.data.disclaimer}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {recommendationsQuery.isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {!recommendationsQuery.isLoading && recommendations.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Aucune recommandation disponible</p>
            <p className="text-sm text-muted-foreground">Lancez une analyse pour generer les mesures de resilience.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {recommendations.map((recommendation) => {
          const breakdown = breakdownByRecommendationId.get(recommendation.id);
          const monthlyCost = breakdown ? breakdown.annualCost / 12 : recommendation.estimatedCost ?? 0;
          const annualSavings = breakdown?.riskReduction ?? 0;
          const individualROI = breakdown?.individualROI ?? 0;
          const isQuickWin = individualROI > 500 && monthlyCost < 500;
          const status = localStatuses[recommendation.id] ?? recommendation.accepted ?? null;

          return (
            <Card key={recommendation.id} className={cn(isQuickWin && 'border-green-500/40')}>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{recommendation.serviceName ?? recommendation.title ?? recommendation.id}</h3>
                  <Badge variant="outline">Tier {recommendation.tier ?? '-'}</Badge>
                  {recommendation.strategy && <Badge>{STRATEGY_LABELS[recommendation.strategy] ?? recommendation.strategy}</Badge>}
                  {isQuickWin && <Badge className="bg-green-500/10 text-green-700 border-green-500/20">Quick Win</Badge>}
                </div>

                <p className="text-sm text-muted-foreground">{recommendation.description}</p>

                <div className="grid gap-3 sm:grid-cols-3">
                  <MiniMetric icon={DollarSign} label="Cout estime" value={`${money(monthlyCost, currencyMeta.symbol)}/mois`} />
                  <MiniMetric icon={TrendingUp} label="Economie annuelle estimee" value={money(annualSavings, currencyMeta.symbol)} />
                  <MiniMetric icon={Clock} label="ROI individuel" value={`${individualROI.toFixed(1)}%`} />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Source: {breakdown ? 'Estimation Stronghold (FinancialEngine)' : 'Estimation recommendation engine'}
                  </p>
                  {status === null ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRecommendationStatus(recommendation, true)}
                        disabled={updateMutation.isPending}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" />
                        Accepter
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRecommendationStatus(recommendation, false)}
                        disabled={updateMutation.isPending}
                      >
                        <X className="mr-1 h-3.5 w-3.5" />
                        Rejeter
                      </Button>
                    </div>
                  ) : (
                    <Badge variant={status ? 'default' : 'secondary'}>
                      {status ? 'Integree au plan' : 'Rejetee'}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold', color)}>{value}</p>
    </div>
  );
}

function MiniMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
