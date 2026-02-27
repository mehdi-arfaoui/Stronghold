import { memo, useMemo, useState, type ReactNode } from 'react';
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
const ROI_DISPLAY_CAP_ABS = 5_000;
const ROI_DISPLAY_HIGH_THRESHOLD = 1_000;

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

function formatMonthlyCostLabel(monthlyCost: number, currency: string): string {
  if (!Number.isFinite(monthlyCost) || monthlyCost <= 0) {
    return 'Inclus dans le service manage';
  }
  return `${money(monthlyCost, currency)}/mois`;
}

function resolveConsistentPayback(input: {
  paybackMonths: number | null | undefined;
  paybackLabel?: string | null;
  roiPercent: number | null | undefined;
  riskAvoidedAnnual: number;
  annualCost: number;
}): { paybackMonths: number | null; paybackLabel?: string } {
  const providedLabel = typeof input.paybackLabel === 'string' ? input.paybackLabel.trim() : '';
  const providedMonths =
    input.paybackMonths != null && Number.isFinite(input.paybackMonths) && input.paybackMonths > 0
      ? input.paybackMonths
      : null;

  if (providedMonths != null) {
    if (providedLabel.length > 0) return { paybackMonths: providedMonths, paybackLabel: providedLabel };
    if (providedMonths > 60) return { paybackMonths: providedMonths, paybackLabel: '> 60 mois' };
    return { paybackMonths: providedMonths };
  }

  if (input.riskAvoidedAnnual > 0 && input.annualCost > 0) {
    const derived = input.annualCost / (input.riskAvoidedAnnual / 12);
    if (!Number.isFinite(derived) || derived <= 0) {
      return { paybackMonths: null, paybackLabel: 'Non rentable' };
    }

    const rounded = Math.round(derived * 10) / 10;
    if (rounded > 60) return { paybackMonths: rounded, paybackLabel: '> 60 mois' };
    return { paybackMonths: rounded };
  }

  if ((input.roiPercent ?? 0) <= 0) {
    return { paybackMonths: null, paybackLabel: 'Non rentable' };
  }

  return { paybackMonths: null, paybackLabel: 'Non rentable' };
}

function formatRoiPercent(value: number | null | undefined): { label: string; tooltip?: string } {
  if (value == null || !Number.isFinite(value)) return { label: 'Non applicable' };
  if (value > ROI_DISPLAY_HIGH_THRESHOLD) {
    return {
      label: '> 1000%',
      tooltip: 'Gain tres eleve par rapport au cout annuel DR estime.',
    };
  }
  if (value < -ROI_DISPLAY_CAP_ABS) {
    return {
      label: '< -5000%',
      tooltip: 'Affichage borne pour eviter une valeur extreme peu exploitable.',
    };
  }
  const bounded = Math.max(-ROI_DISPLAY_CAP_ABS, Math.min(ROI_DISPLAY_CAP_ABS, value));
  return {
    label: `${bounded.toFixed(1)}%`,
  };
}

function mapCostSourceLabel(costSource: string | undefined): string {
  if (!costSource) return 'Estimation Stronghold';
  if (costSource.startsWith('budget_profile_calibration:')) {
    return `Calibration budget (${mapCostSourceLabel(costSource.split(':')[1])})`;
  }
  if (costSource === 'cost-explorer') return '[Prix reel ✓✓]';
  if (costSource === 'pricing-api') return '[Prix API ✓]';
  if (costSource === 'static-table') return '[Estimation ≈]';
  if (costSource === 'user_override') return 'Override utilisateur';
  if (costSource === 'cloud_type_reference') return 'Reference cloud';
  if (costSource === 'criticality_fallback') return 'Fallback criticite';
  return 'Estimation Stronghold';
}

function resolveCompactCostSourceLabel(input: {
  costSource?: string;
  costSourceLabel?: string;
}): string | null {
  const explicit = input.costSourceLabel?.trim();
  if (explicit && explicit.startsWith('[')) {
    return explicit;
  }
  if (!input.costSource) return null;
  const mapped = mapCostSourceLabel(input.costSource);
  return mapped.startsWith('[') ? mapped : null;
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

type RecommendationCriticality = 'critical' | 'high' | 'medium' | 'low';

function resolveCriticalityFromTier(tier: number | null | undefined): RecommendationCriticality {
  if (tier === 1) return 'critical';
  if (tier === 2) return 'high';
  if (tier === 3) return 'medium';
  return 'low';
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

  const baseRecommendations = recommendationsQuery.data ?? [];
  const roiPayloadDigest = useMemo(
    () =>
      baseRecommendations
        .map((recommendation) => `${recommendation.id}:${recommendation.estimatedCost ?? 0}:${recommendation.strategy ?? 'default'}`)
        .join('|'),
    [baseRecommendations],
  );

  const roiQuery = useQuery({
    queryKey: ['financial-recommendations-roi', tenantScope, currency, roiPayloadDigest],
    enabled: baseRecommendations.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      (
        await financialApi.calculateROI({
          currency,
          recommendations: baseRecommendations.map((recommendation) => ({
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

  const recommendationCards = useMemo(() => {
    const criticalityOrder: Record<RecommendationCriticality, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return [...baseRecommendations]
      .map((recommendation) => {
        const breakdown = breakdownByRecommendationId.get(recommendation.id);
        const monthlyCost = recommendation.estimatedCost ?? (breakdown ? breakdown.annualCost / 12 : 0);
        const annualCost = recommendation.estimatedAnnualCost ?? breakdown?.annualCost ?? monthlyCost * 12;
        const annualSavings = recommendation.calculation?.riskAvoidedAnnual ?? breakdown?.riskReduction ?? 0;
        const individualROI = recommendation.roi ?? breakdown?.individualROI ?? null;
        const paybackMonths = recommendation.paybackMonths ?? breakdown?.paybackMonths ?? null;
        const paybackLabel = recommendation.paybackLabel ?? breakdown?.paybackLabel;
        const resolvedPayback =
          annualCost > 0
            ? resolveConsistentPayback({
                paybackMonths,
                paybackLabel,
                roiPercent: individualROI,
                riskAvoidedAnnual: annualSavings,
                annualCost,
              })
            : { paybackMonths: null as number | null };

        return {
          recommendation,
          breakdown,
          monthlyCost,
          annualCost,
          annualSavings,
          individualROI,
          roiStatus: recommendation.roiStatus ?? breakdown?.roiStatus,
          roiMessage: recommendation.roiMessage ?? breakdown?.roiMessage,
          resolvedPayback,
          criticality: resolveCriticalityFromTier(recommendation.tier),
        };
      })
      .sort((left, right) => {
        const savingsDiff = (right.annualSavings ?? 0) - (left.annualSavings ?? 0);
        if (savingsDiff !== 0) return savingsDiff;

        const costDiff = (right.annualCost ?? 0) - (left.annualCost ?? 0);
        if (costDiff !== 0) return costDiff;

        return (criticalityOrder[left.criticality] ?? 99) - (criticalityOrder[right.criticality] ?? 99);
      });
  }, [baseRecommendations, breakdownByRecommendationId]);

  const prioritizedRecommendations = useMemo(
    () => recommendationCards.filter((card) => card.annualCost > 0 || card.annualSavings > 0),
    [recommendationCards],
  );
  const informativeRecommendations = useMemo(
    () => recommendationCards.filter((card) => card.annualCost <= 0 && card.annualSavings <= 0),
    [recommendationCards],
  );

  const summaryRiskAvoided =
    recommendationsSummaryQuery.data?.riskAvoidedAnnual ?? roiQuery.data?.riskReductionAmount ?? 0;
  const summaryAnnualCost =
    recommendationsSummaryQuery.data?.totalAnnualCost ?? roiQuery.data?.annualRemediationCost ?? 0;
  const summaryRoiPercent =
    recommendationsSummaryQuery.data?.roiPercent ?? roiQuery.data?.roiPercent ?? null;
  const summaryPaybackMonths =
    recommendationsSummaryQuery.data?.paybackMonths ?? roiQuery.data?.paybackMonths ?? null;
  const summaryPaybackLabel = recommendationsSummaryQuery.data?.paybackLabel ?? roiQuery.data?.paybackLabel;
  const summaryTotalRecommendations =
    recommendationsSummaryQuery.data?.totalRecommendations ?? recommendationCards.length;
  const summaryRoiDisplay = formatRoiPercent(summaryRoiPercent);
  const summaryRiskAvoidedDisplay =
    summaryRiskAvoided < 0 ? 'Aucun gain - service deja protege' : money(summaryRiskAvoided, currency);
  const resolvedSummaryPayback = resolveConsistentPayback({
    paybackMonths: summaryPaybackMonths,
    paybackLabel: summaryPaybackLabel,
    roiPercent: summaryRoiPercent,
    riskAvoidedAnnual: summaryRiskAvoided,
    annualCost: summaryAnnualCost,
  });

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

  const renderRecommendationCard = (card: (typeof recommendationCards)[number]) => {
    const recommendation = card.recommendation;
    const individualRoiDisplay = formatRoiPercent(card.individualROI);
    const isQuickWin =
      card.resolvedPayback.paybackLabel === 'Quick win' ||
      ((card.individualROI ?? 0) > 500 && card.monthlyCost < 500);
    const status = localStatuses[recommendation.id] ?? resolveRecommendationStatus(recommendation);
    const strategyLabel = STRATEGY_LABELS[String(recommendation.strategy)] ?? recommendation.strategy;
    const costSourceBadge = resolveCompactCostSourceLabel({
      costSource: recommendation.costSource,
      costSourceLabel: recommendation.costSourceLabel,
    });

    return (
      <Card key={recommendation.id} className={cn(isQuickWin && 'border-green-500/40')}>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{recommendation.serviceName ?? recommendation.title ?? recommendation.id}</h3>
            <Badge variant="outline">Tier {recommendation.tier ?? '-'}</Badge>
            {recommendation.strategy && <Badge>{strategyLabel}</Badge>}
            {isQuickWin && <Badge className="bg-green-500/10 text-green-700 border-green-500/20">Quick Win</Badge>}
            {card.roiMessage && (
              <Badge
                className={cn(
                  'border',
                  card.roiStatus === 'strongly_recommended' && 'border-green-300 bg-green-50 text-green-800',
                  card.roiStatus === 'rentable' && 'border-amber-300 bg-amber-50 text-amber-800',
                  card.roiStatus === 'cost_exceeds_avoided_risk' && 'border-red-300 bg-red-50 text-red-800',
                  card.roiStatus === 'non_applicable' && 'border-muted bg-muted/20 text-muted-foreground',
                )}
              >
                {card.roiMessage}
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
            <MiniMetric
              icon={DollarSign}
              label="Cout estime"
              value={
                <span className="inline-flex flex-wrap items-center gap-1">
                  {formatMonthlyCostLabel(card.monthlyCost, currency)}
                  {costSourceBadge && (
                    <Badge variant="outline" className="text-[10px] leading-none">
                      {costSourceBadge}
                    </Badge>
                  )}
                </span>
              }
            />
            <MiniMetric icon={DollarSign} label="Cout annuel DR" value={money(card.annualCost, currency)} />
            <MiniMetric
              icon={TrendingUp}
              label="Economie annuelle estimee"
              value={card.annualSavings < 0 ? 'Aucun gain - service deja protege' : money(card.annualSavings, currency)}
            />
            <MiniMetric
              icon={Clock}
              label={card.individualROI == null ? 'ROI individuel' : card.individualROI >= 0 ? 'ROI individuel' : 'ROI negatif'}
              value={
                <span title={individualRoiDisplay.tooltip}>
                  {individualRoiDisplay.label}
                </span>
              }
            />
          </div>
          {card.annualCost > 0 && (
            <div className="text-xs text-muted-foreground">
              Payback:{' '}
              <span className="font-medium">
                {formatPaybackMonths(card.resolvedPayback.paybackMonths, card.resolvedPayback.paybackLabel)}
              </span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
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
          {recommendation.calculation && (
            <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">Comment c est calcule</summary>
              <div className="mt-2 space-y-1 text-muted-foreground">
                <p>{recommendation.calculation.formula}</p>
                <p>ALE actuel: {money(recommendation.calculation.aleCurrent, currency)}</p>
                <p>ALE apres DR: {money(recommendation.calculation.aleAfter, currency)}</p>
                <p>
                  Risque evite annuel:{' '}
                  {recommendation.calculation.riskAvoidedAnnual < 0
                    ? 'Aucun gain - service deja protege'
                    : money(recommendation.calculation.riskAvoidedAnnual, currency)}
                </p>
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
                value={summaryRiskAvoidedDisplay}
                color={summaryRiskAvoided < 0 ? 'text-amber-700' : 'text-green-600'}
              />
              <Metric
                label="Cout annuel DR"
                value={money(summaryAnnualCost, currency)}
              />
              <Metric
                label="ROI global"
                value={
                  <span title={summaryRoiDisplay.tooltip}>
                    {summaryRoiDisplay.label}
                  </span>
                }
                color={roiToneClass(undefined, summaryRoiPercent)}
              />
              <Metric
                label="Payback"
                value={formatPaybackMonths(
                  resolvedSummaryPayback.paybackMonths,
                  resolvedSummaryPayback.paybackLabel,
                )}
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

      {!recommendationsQuery.isLoading && recommendationCards.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Aucune recommandation disponible</p>
            <p className="text-sm text-muted-foreground">Lancez une analyse pour generer les mesures de resilience.</p>
          </CardContent>
        </Card>
      )}

      {!recommendationsQuery.isLoading && recommendationCards.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-md border px-3 py-2 bg-muted/10">
            <p className="text-sm font-semibold">
              Recommandations prioritaires ({prioritizedRecommendations.length})
            </p>
          </div>
          <div className="space-y-3">
            {prioritizedRecommendations.map(renderRecommendationCard)}
          </div>

          <details className="rounded-md border bg-muted/20">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
              Recommandations informatives ({informativeRecommendations.length})
            </summary>
            <div className="space-y-3 p-3 pt-0">
              {informativeRecommendations.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune recommandation informative.</p>
              ) : (
                informativeRecommendations.map(renderRecommendationCard)
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

const Metric = memo(function Metric({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold', color)}>{value}</p>
    </div>
  );
});

const MiniMetric = memo(function MiniMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof DollarSign;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
});


