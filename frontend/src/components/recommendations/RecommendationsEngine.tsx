import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
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
import { formatCurrency } from '@/lib/formatters';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;

const STRATEGY_LABELS: Record<string, string> = {
  'backup-restore': 'Backup & Restore',
  'backup_restore': 'Backup & Restore',
  backup: 'Backup & Restore',
  'pilot-light': 'Pilot Light',
  pilot_light: 'Pilot Light',
  'warm-standby': 'Warm Standby',
  warm_standby: 'Warm Standby',
  'hot-standby': 'Hot Standby',
  hot_standby: 'Hot Standby',
  'active-active': 'Active-Active',
  active_active: 'Active-Active',
};

function normalizeStrategy(strategy?: Recommendation['strategy']): string | undefined {
  if (!strategy) return undefined;
  if (strategy === 'backup-restore') return 'backup_restore';
  return String(strategy).replace(/-/g, '_');
}

function money(amount: number | null | undefined, currency: string): string {
  if (amount == null || !Number.isFinite(amount)) return 'N/A';
  return formatCurrency(amount, currency);
}

function formatPaybackMonths(paybackMonths: number | null | undefined, paybackLabel?: string): string {
  if (paybackLabel && paybackLabel.trim().length > 0) return paybackLabel;
  if (paybackMonths == null || !Number.isFinite(paybackMonths) || paybackMonths <= 0) {
    return 'Non rentable';
  }
  return `${paybackMonths.toFixed(1)} mois`;
}

function formatRoiPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Non applicable';
  return `${value.toFixed(1)}%`;
}

function mapCostSourceLabel(costSource: string | undefined): string {
  if (costSource === 'user_override') return 'Override utilisateur';
  if (costSource === 'cloud_type_reference') return 'Reference cloud';
  if (costSource === 'criticality_fallback') return 'Fallback criticite';
  return 'Estimation Stronghold';
}

function roiToneClass(status: string | undefined, roi: number | null | undefined): string {
  if (status === 'strongly_recommended') return 'text-green-700';
  if (status === 'rentable') return 'text-amber-700';
  if (status === 'cost_exceeds_avoided_risk') return 'text-red-700';
  if (status === 'non_applicable') return 'text-muted-foreground';
  if (roi == null) return 'text-muted-foreground';
  if (roi > 100) return 'text-green-700';
  if (roi >= 0) return 'text-amber-700';
  return 'text-red-700';
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

type RecommendationStatus = 'pending' | 'validated' | 'rejected';

function resolveRecommendationStatus(recommendation: Recommendation): RecommendationStatus {
  if (recommendation.status === 'validated' || recommendation.status === 'rejected' || recommendation.status === 'pending') {
    return recommendation.status;
  }
  if (recommendation.accepted === true) return 'validated';
  if (recommendation.accepted === false) return 'rejected';
  return 'pending';
}

function recommendationStatusLabel(status: RecommendationStatus): string {
  if (status === 'validated') return 'Validee';
  if (status === 'rejected') return 'Rejetee';
  return 'En attente';
}

export function RecommendationsEngine({ className }: RecommendationsEngineProps) {
  const queryClient = useQueryClient();
  const tenantScope = getCredentialScopeKey();
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Record<string, RecommendationStatus>>({});

  const orgProfileQuery = useQuery({
    queryKey: ['financial-org-profile', tenantScope],
    queryFn: async () => (await financialApi.getOrgProfile()).data,
    staleTime: 60_000,
  });

  const profileCurrency = useMemo(() => {
    const resolved = String(orgProfileQuery.data?.customCurrency ?? '').toUpperCase();
    return (CURRENCIES as readonly string[]).includes(resolved) ? resolved : 'EUR';
  }, [orgProfileQuery.data?.customCurrency]);
  const currency = currencyOverride ?? profileCurrency;

  const recommendationsQuery = useQuery({
    queryKey: ['recommendations', tenantScope],
    queryFn: async () => (await recommendationsApi.getAll()).data,
  });
  const recommendationsSummaryQuery = useQuery({
    queryKey: ['recommendations-summary', tenantScope],
    queryFn: async () => (await recommendationsApi.getSummary()).data,
    staleTime: 60_000,
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
    mutationFn: ({ id, status }: { id: string; status: RecommendationStatus }) =>
      recommendationsApi.updateStatus(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recommendations', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['recommendations-summary', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['financial-recommendations-roi', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['financial-summary', tenantScope] });
    },
    onError: () => {
      toast.error('Mise a jour de statut impossible');
    },
  });

  const breakdownByRecommendationId = useMemo(() => {
    const breakdown = roiQuery.data?.breakdownByRecommendation ?? [];
    return new Map(breakdown.map((entry) => [entry.recommendationId, entry]));
  }, [roiQuery.data]);

  const summaryRiskAvoided =
    recommendationsSummaryQuery.data?.riskAvoidedAnnual ?? roiQuery.data?.riskReductionAmount ?? 0;
  const summaryAnnualCost =
    recommendationsSummaryQuery.data?.totalAnnualCost ?? roiQuery.data?.annualRemediationCost ?? 0;
  const summaryRoiPercent =
    recommendationsSummaryQuery.data?.roiPercent ?? roiQuery.data?.roiPercent ?? null;
  const summaryPaybackMonths =
    recommendationsSummaryQuery.data?.paybackMonths ?? roiQuery.data?.paybackMonths ?? null;
  const summaryTotalRecommendations =
    recommendationsSummaryQuery.data?.totalRecommendations ?? recommendations.length;

  const setRecommendationStatus = (recommendation: Recommendation, status: RecommendationStatus) => {
    setLocalStatuses((previous) => ({ ...previous, [recommendation.id]: status }));
    updateMutation.mutate({ id: recommendation.id, status });
    toast.success(
      status === 'validated'
        ? 'Recommandation validee'
        : status === 'rejected'
          ? 'Recommandation rejetee'
          : 'Recommandation reouverte',
    );
  };

  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recommandations IA</h2>
        </div>
        <Select value={currency} onValueChange={(next) => setCurrencyOverride(next)}>
          <SelectTrigger className="w-[110px]" aria-label="Devise">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(recommendationsSummaryQuery.isLoading || roiQuery.isLoading) && (
        <Card>
          <CardContent className="py-8 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </CardContent>
        </Card>
      )}

      {(recommendationsSummaryQuery.data || roiQuery.data) && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              ROI de vos recommandations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Risque annuel evite"
                value={money(summaryRiskAvoided, currency)}
                color="text-green-600"
              />
              <Metric
                label="Cout annuel DR"
                value={money(summaryAnnualCost, currency)}
              />
              <Metric
                label="ROI global"
                value={formatRoiPercent(summaryRoiPercent)}
                color={roiToneClass(undefined, summaryRoiPercent)}
              />
              <Metric
                label="Payback"
                value={formatPaybackMonths(summaryPaybackMonths)}
              />
            </div>

            <div className="rounded-lg border bg-muted/20 p-4 space-y-1">
              <p>
                Budget DR estime:{' '}
                <span className="font-semibold">
                  {money(recommendationsSummaryQuery.data?.budgetAnnual, currency)}
                </span>
              </p>
              <p>
                Recommandations: <span className="font-semibold">{summaryTotalRecommendations}</span>
              </p>
              <p>
                Repartition budget DR par strategie: {Object.entries(recommendationsSummaryQuery.data?.costSharePercentByStrategy ?? {})
                  .map(([strategy, share]) => `${STRATEGY_LABELS[strategy] ?? strategy}: ${Number(share).toFixed(1)}%`)
                  .join(' | ') || 'N/A'}
              </p>
              {recommendationsSummaryQuery.data?.financialDisclaimers?.strategy && (
                <p className="text-xs text-muted-foreground mt-2">
                  Source: {recommendationsSummaryQuery.data?.financialDisclaimers?.strategy}
                </p>
              )}
              {roiQuery.data?.disclaimer && !recommendationsSummaryQuery.data?.financialDisclaimers?.strategy && (
                <p className="text-xs text-muted-foreground mt-2">Source: {roiQuery.data.disclaimer}</p>
              )}
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
          const monthlyCost = recommendation.estimatedCost ?? (breakdown ? breakdown.annualCost / 12 : 0);
          const annualCost = recommendation.estimatedAnnualCost ?? breakdown?.annualCost ?? monthlyCost * 12;
          const annualSavings = recommendation.calculation?.riskAvoidedAnnual ?? breakdown?.riskReduction ?? 0;
          const individualROI = recommendation.roi ?? breakdown?.individualROI ?? null;
          const roiStatus = recommendation.roiStatus ?? breakdown?.roiStatus;
          const roiMessage = recommendation.roiMessage ?? breakdown?.roiMessage;
          const paybackMonths = recommendation.paybackMonths ?? breakdown?.paybackMonths ?? null;
          const paybackLabel = recommendation.paybackLabel ?? breakdown?.paybackLabel;
          const isQuickWin = paybackLabel === 'Quick win' || ((individualROI ?? 0) > 500 && monthlyCost < 500);
          const status = localStatuses[recommendation.id] ?? resolveRecommendationStatus(recommendation);
          const strategyLabel = STRATEGY_LABELS[String(recommendation.strategy)] ?? recommendation.strategy;

          return (
            <Card key={recommendation.id} className={cn(isQuickWin && 'border-green-500/40')}>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{recommendation.serviceName ?? recommendation.title ?? recommendation.id}</h3>
                  <Badge variant="outline">Tier {recommendation.tier ?? '-'}</Badge>
                  {recommendation.strategy && <Badge>{strategyLabel}</Badge>}
                  {recommendation.costSource && recommendation.costSource !== 'user_override' && (
                    <Badge variant="outline">Estimation - basee sur votre profil</Badge>
                  )}
                  {isQuickWin && <Badge className="bg-green-500/10 text-green-700 border-green-500/20">Quick Win</Badge>}
                  {roiMessage && (
                    <Badge
                      className={cn(
                        'border',
                        roiStatus === 'strongly_recommended' && 'border-green-300 bg-green-50 text-green-800',
                        roiStatus === 'rentable' && 'border-amber-300 bg-amber-50 text-amber-800',
                        roiStatus === 'cost_exceeds_avoided_risk' && 'border-red-300 bg-red-50 text-red-800',
                        roiStatus === 'non_applicable' && 'border-muted bg-muted/20 text-muted-foreground',
                      )}
                    >
                      {roiMessage}
                    </Badge>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">{recommendation.description}</p>
                {recommendation.budgetWarning && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="inline-flex items-center gap-1 font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {recommendation.budgetWarning}
                    </span>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-4">
                  <MiniMetric icon={DollarSign} label="Cout estime" value={`${money(monthlyCost, currency)}/mois`} />
                  <MiniMetric icon={DollarSign} label="Cout annuel DR" value={money(annualCost, currency)} />
                  <MiniMetric icon={TrendingUp} label={annualSavings >= 0 ? 'Economie annuelle estimee' : 'Cout annuel estime'} value={money(annualSavings, currency)} />
                  <MiniMetric
                    icon={Clock}
                    label={individualROI == null ? 'ROI individuel' : individualROI >= 0 ? 'ROI individuel' : 'ROI negatif'}
                    value={formatRoiPercent(individualROI)}
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  Payback: <span className="font-medium">{formatPaybackMonths(paybackMonths, paybackLabel)}</span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Source cout: {mapCostSourceLabel(recommendation.costSource)}{typeof recommendation.costConfidence === 'number' ? ` (confiance ${(recommendation.costConfidence * 100).toFixed(0)}%)` : ''}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={status === 'validated' ? 'default' : status === 'rejected' ? 'secondary' : 'outline'}
                    >
                      {recommendationStatusLabel(status)}
                    </Badge>
                    {status === 'pending' ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRecommendationStatus(recommendation, 'validated')}
                          disabled={updateMutation.isPending}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          Accepter
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRecommendationStatus(recommendation, 'rejected')}
                          disabled={updateMutation.isPending}
                        >
                          <X className="mr-1 h-3.5 w-3.5" />
                          Rejeter
                        </Button>
                      </>
                    ) : status === 'validated' ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRecommendationStatus(recommendation, 'rejected')}
                          disabled={updateMutation.isPending}
                        >
                          <X className="mr-1 h-3.5 w-3.5" />
                          Rejeter
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRecommendationStatus(recommendation, 'pending')}
                          disabled={updateMutation.isPending}
                        >
                          Reouvrir
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRecommendationStatus(recommendation, 'validated')}
                          disabled={updateMutation.isPending}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          Accepter
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRecommendationStatus(recommendation, 'pending')}
                          disabled={updateMutation.isPending}
                        >
                          Reouvrir
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {recommendation.calculation && (
                  <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                    <summary className="cursor-pointer font-medium">Comment c est calcule</summary>
                    <div className="mt-2 space-y-1 text-muted-foreground">
                      <p>{recommendation.calculation.formula}</p>
                      <p>ALE actuel: {money(recommendation.calculation.aleCurrent, currency)}</p>
                      <p>ALE apres DR: {money(recommendation.calculation.aleAfter, currency)}</p>
                      <p>Risque evite annuel: {money(recommendation.calculation.riskAvoidedAnnual, currency)}</p>
                      <p>Cout annuel DR: {money(recommendation.calculation.annualDrCost, currency)}</p>
                      <p>
                        Inputs: cout downtime/h {money(recommendation.calculation.inputs.hourlyDowntimeCost, currency)},
                        RTO actuel {recommendation.calculation.inputs.currentRtoHours}h,
                        RTO cible {recommendation.calculation.inputs.targetRtoHours}h,
                        proba {recommendation.calculation.inputs.incidentProbabilityAnnual}
                      </p>
                    </div>
                  </details>
                )}
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
