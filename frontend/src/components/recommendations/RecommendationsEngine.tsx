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
  RotateCcw,
  TrendingUp,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { recommendationsApi, type Recommendation } from '@/api/recommendations.api';
import { financialApi } from '@/api/financial.api';
import { ServiceIdentityLabel } from '@/components/common/ServiceIdentityLabel';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import { formatCurrency } from '@/lib/formatters';
import { resolveIdentityLabels } from '@/lib/serviceIdentity';

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

const STRATEGY_FILTER_OPTIONS = [
  { value: 'backup_restore', label: 'Backup & Restore' },
  { value: 'pilot_light', label: 'Pilot Light' },
  { value: 'warm_standby', label: 'Warm Standby' },
  { value: 'hot_standby', label: 'Hot Standby' },
  { value: 'active_active', label: 'Active-Active' },
] as const;

type StrategyFilterValue = (typeof STRATEGY_FILTER_OPTIONS)[number]['value'];
type RoiSortDirection = 'asc' | 'desc';

const DEFAULT_STRATEGY_FILTERS: StrategyFilterValue[] = STRATEGY_FILTER_OPTIONS.map((option) => option.value);

function normalizeStrategy(strategy?: Recommendation['strategy']): string | undefined {
  if (!strategy) return undefined;
  if (strategy === 'backup-restore') return 'backup_restore';
  return String(strategy).replace(/-/g, '_');
}

function strategyFilterLabel(selectedStrategies: StrategyFilterValue[]): string {
  if (selectedStrategies.length === 0) return 'Aucune';
  if (selectedStrategies.length === DEFAULT_STRATEGY_FILTERS.length) return 'Toutes';
  if (selectedStrategies.length === 1) {
    return STRATEGY_FILTER_OPTIONS.find((option) => option.value === selectedStrategies[0])?.label ?? '1 stratégie';
  }
  return `${selectedStrategies.length} stratégies`;
}

function recommendationRoiValue(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : 0;
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
  return `${paybackMonths.toFixed(1).replace('.', ',')} mois`;
}

function formatMonthlyCostLabel(monthlyCost: number, currency: string): string {
  if (!Number.isFinite(monthlyCost) || monthlyCost <= 0) {
    return 'Inclus dans le service managé';
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
      tooltip: 'Gain très élevé par rapport au coût annuel DR estimé.',
    };
  }
  if (value < -ROI_DISPLAY_CAP_ABS) {
    return {
      label: '< -5000%',
      tooltip: 'Affichage borné pour éviter une valeur extrême peu exploitable.',
    };
  }
  const bounded = Math.max(-ROI_DISPLAY_CAP_ABS, Math.min(ROI_DISPLAY_CAP_ABS, value));
  return {
    label: `${bounded.toFixed(1).replace('.', ',')}%`,
  };
}

function mapCostSourceLabel(costSource: string | undefined): string {
  if (!costSource) return 'Table statique';
  if (costSource === 'cost-explorer') return 'Prix reel';
  if (costSource === 'pricing-api') return 'Prix API live';
  if (costSource === 'static-table') return 'Table statique';
  if (costSource === 'family-estimate') return 'Estimation famille';
  if (costSource === 'category-estimate') return 'Estimation categorie';
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
  if (explicit) {
    return explicit.replace(/^\[/, '').replace(/\]$/, '').replace('≈', '').trim();
  }
  if (!input.costSource) return null;
  return mapCostSourceLabel(input.costSource);
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
  if (status === 'validated') return 'Validée';
  if (status === 'rejected') return 'Rejetée';
  return 'En attente';
}

export function RecommendationsEngine({ className }: RecommendationsEngineProps) {
  const queryClient = useQueryClient();
  const tenantScope = getCredentialScopeKey();
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Record<string, RecommendationStatus>>({});
  const [selectedStrategies, setSelectedStrategies] = useState<StrategyFilterValue[]>(DEFAULT_STRATEGY_FILTERS);
  const [maxAnnualCostInput, setMaxAnnualCostInput] = useState('');
  const [roiSortDirection, setRoiSortDirection] = useState<RoiSortDirection>('desc');

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
  const isFinancialProfileConfigured = Boolean(orgProfileQuery.data?.isConfigured);

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
    enabled: baseRecommendations.length > 0 && isFinancialProfileConfigured,
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
      toast.error('Mise à jour de statut impossible');
    },
  });

  const breakdownByRecommendationId = useMemo(() => {
    const breakdown = roiQuery.data?.breakdownByRecommendation ?? [];
    return new Map(breakdown.map((entry) => [entry.recommendationId, entry]));
  }, [roiQuery.data]);

  const recommendationCards = useMemo(() => {
    return [...baseRecommendations].map((recommendation) => {
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
        strategyKey: normalizeStrategy(recommendation.strategy) as StrategyFilterValue | undefined,
        monthlyCost,
        annualCost,
        annualSavings,
        individualROI,
        roiStatus: recommendation.roiStatus ?? breakdown?.roiStatus,
        roiMessage: recommendation.roiMessage ?? breakdown?.roiMessage,
        resolvedPayback,
      };
    });
  }, [baseRecommendations, breakdownByRecommendationId]);

  const totalDrBudget = useMemo(
    () => recommendationCards.reduce((sum, card) => sum + Math.max(0, card.annualCost || 0), 0),
    [recommendationCards],
  );

  const filteredRecommendationCards = useMemo(() => {
    const selectedStrategySet = new Set(selectedStrategies);
    const parsedMaxAnnualCost = Number(maxAnnualCostInput);
    const hasCostFilter =
      maxAnnualCostInput.trim().length > 0 && Number.isFinite(parsedMaxAnnualCost) && parsedMaxAnnualCost >= 0;

    return recommendationCards
      .filter((card) => {
        const strategyMatches = card.strategyKey
          ? selectedStrategySet.has(card.strategyKey)
          : selectedStrategies.length === DEFAULT_STRATEGY_FILTERS.length;
        const costMatches = !hasCostFilter || card.annualCost <= parsedMaxAnnualCost;
        return strategyMatches && costMatches;
      })
      .sort((left, right) => {
        const roiDiff =
          roiSortDirection === 'asc'
            ? recommendationRoiValue(left.individualROI) - recommendationRoiValue(right.individualROI)
            : recommendationRoiValue(right.individualROI) - recommendationRoiValue(left.individualROI);
        if (roiDiff !== 0) return roiDiff;

        const paybackDiff =
          (left.resolvedPayback.paybackMonths ?? Number.POSITIVE_INFINITY) -
          (right.resolvedPayback.paybackMonths ?? Number.POSITIVE_INFINITY);
        if (paybackDiff !== 0) return paybackDiff;

        return (right.annualSavings ?? 0) - (left.annualSavings ?? 0);
      });
  }, [maxAnnualCostInput, recommendationCards, roiSortDirection, selectedStrategies]);

  const { quickWinCards, otherRecommendationCards } = useMemo(() => {
    if (!isFinancialProfileConfigured) {
      return {
        quickWinCards: [] as typeof filteredRecommendationCards,
        otherRecommendationCards: filteredRecommendationCards,
      };
    }

    const quickWins = filteredRecommendationCards.filter((card) => {
      const quickWinByBudget =
        recommendationRoiValue(card.individualROI) > 100 &&
        Math.max(0, card.annualCost) < totalDrBudget * 0.2;
      const quickWinByPayback = (card.resolvedPayback.paybackMonths ?? Number.POSITIVE_INFINITY) < 6;
      return quickWinByBudget || quickWinByPayback;
    });
    const quickWinIds = new Set(quickWins.map((card) => card.recommendation.id));

    return {
      quickWinCards: quickWins,
      otherRecommendationCards: filteredRecommendationCards.filter(
        (card) => !quickWinIds.has(card.recommendation.id),
      ),
    };
  }, [filteredRecommendationCards, isFinancialProfileConfigured, totalDrBudget]);

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
  const summarySecondaryRecommendations = recommendationsSummaryQuery.data?.secondaryRecommendations ?? 0;
  const summarySecondaryAnnualCost = recommendationsSummaryQuery.data?.secondaryAnnualCost ?? 0;
  const summaryAnnualCostCap = recommendationsSummaryQuery.data?.annualCostCap ?? 0;
  const summaryBudgetAnnual = recommendationsSummaryQuery.data?.budgetAnnual ?? null;
  const hasConfiguredBudgetCap =
    summaryBudgetAnnual != null &&
    Number.isFinite(Number(summaryBudgetAnnual)) &&
    Number(summaryBudgetAnnual) > 0;
  const summarySelectedAnnualCost =
    recommendationsSummaryQuery.data?.selectedAnnualCost ?? summaryAnnualCost;
  const summaryRemainingBudgetAnnual =
    recommendationsSummaryQuery.data?.remainingBudgetAnnual ?? null;
  const summaryRoiDisplay = formatRoiPercent(summaryRoiPercent);
  const summaryRiskAvoidedDisplay =
    summaryRiskAvoided < 0 ? 'Aucun gain - service déjà protégé' : money(summaryRiskAvoided, currency);
  const resolvedSummaryPayback = resolveConsistentPayback({
    paybackMonths: summaryPaybackMonths,
    paybackLabel: summaryPaybackLabel,
    roiPercent: summaryRoiPercent,
    riskAvoidedAnnual: summaryRiskAvoided,
    annualCost: summaryAnnualCost,
  });
  const filteredOutOfBudgetCount = filteredRecommendationCards.filter(
    (card) => card.recommendation.withinBudgetCap === false,
  ).length;
  const hasActiveFilters =
    maxAnnualCostInput.trim().length > 0 ||
    roiSortDirection !== 'desc' ||
    selectedStrategies.length !== DEFAULT_STRATEGY_FILTERS.length;

  const toggleStrategyFilter = (strategy: StrategyFilterValue, checked: boolean) => {
    setSelectedStrategies((current) => {
      if (checked) {
        return current.includes(strategy) ? current : [...current, strategy];
      }
      return current.filter((value) => value !== strategy);
    });
  };

  const resetFilters = () => {
    setSelectedStrategies(DEFAULT_STRATEGY_FILTERS);
    setMaxAnnualCostInput('');
    setRoiSortDirection('desc');
  };

  const setRecommendationStatus = (recommendation: Recommendation, status: RecommendationStatus) => {
    setLocalStatuses((previous) => ({ ...previous, [recommendation.id]: status }));
    updateMutation.mutate({ id: recommendation.id, status });
    toast.success(
      status === 'validated'
        ? 'Recommandation validée'
        : status === 'rejected'
          ? 'Recommandation rejetée'
        : 'Recommandation réouverte',
    );
  };

  const renderRecommendationCard = (card: (typeof recommendationCards)[number], isQuickWin: boolean) => {
    const recommendation = card.recommendation;
    const identity = resolveIdentityLabels(recommendation);
    const individualRoiDisplay = formatRoiPercent(card.individualROI);
    const status = localStatuses[recommendation.id] ?? resolveRecommendationStatus(recommendation);
    const strategyLabel =
      STRATEGY_LABELS[card.strategyKey ?? ''] ??
      STRATEGY_LABELS[String(recommendation.strategy)] ??
      recommendation.strategy;
    const costSourceBadge = resolveCompactCostSourceLabel({
      costSource: recommendation.costSource,
      costSourceLabel: recommendation.costSourceLabel,
    });
    const isOutOfBudget = recommendation.withinBudgetCap === false;
    const secondaryActionBadge = isQuickWin
      ? 'Quick Win'
      : Number(recommendation.tier || 0) === 1
        ? 'Prioritaire'
        : null;

    return (
      <Card
        key={recommendation.id}
        className={cn(
          isOutOfBudget ? 'opacity-60' : 'border-green-500/35',
          isQuickWin && 'border-green-500/50',
        )}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[220px] flex-1">
              <ServiceIdentityLabel
                primary={identity.primary}
                secondary={identity.secondary}
                className="font-semibold"
              />
            </div>
            {strategyLabel && <Badge variant="outline">{strategyLabel}</Badge>}
            {secondaryActionBadge && (
              <Badge
                className={cn(
                  secondaryActionBadge === 'Quick Win'
                    ? 'border-green-500/20 bg-green-500/10 text-green-700'
                    : 'border-orange-500/20 bg-orange-500/10 text-orange-700',
                )}
              >
                {secondaryActionBadge}
              </Badge>
            )}
          </div>

          <p className="text-sm text-muted-foreground">{recommendation.description}</p>
          {recommendation.requiresVerification && (
            <p className="inline-flex items-center gap-1 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              Verification manuelle recommandee (metadonnees incompletes)
            </p>
          )}
          {recommendation.budgetWarning && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span className="inline-flex items-center gap-1 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                {recommendation.budgetWarning}
              </span>
            </div>
          )}

          <div className={cn('grid gap-3', isFinancialProfileConfigured ? 'sm:grid-cols-3' : 'sm:grid-cols-1')}>
            <MiniMetric
              icon={DollarSign}
              label="Cout additionnel"
              value={
                <span className="inline-flex flex-col items-start gap-1">
                  <span>{formatMonthlyCostLabel(card.monthlyCost, currency)}</span>
                  {costSourceBadge && <span className="text-xs text-muted-foreground">Source prix: {costSourceBadge}</span>}
                </span>
              }
            />
            {isFinancialProfileConfigured && (
              <MiniMetric
                icon={TrendingUp}
                label="Economie annuelle"
                value={card.annualSavings < 0 ? 'Aucun gain - service deja protege' : money(card.annualSavings, currency)}
              />
            )}
            {isFinancialProfileConfigured && (
              <MiniMetric
                icon={Clock}
                label="ROI"
                value={
                  <span title={individualRoiDisplay.tooltip}>
                    {individualRoiDisplay.label}
                  </span>
                }
              />
            )}
          </div>
          {!isFinancialProfileConfigured && (
            <p className="text-xs text-muted-foreground">
              Configurez votre profil financier pour afficher ROI, payback et economie annuelle.
            </p>
          )}
          {isFinancialProfileConfigured && card.annualCost > 0 && (
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
                  Réouvrir
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
                  Réouvrir
                </Button>
              </>
            )}
          </div>
          <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium">Comment c'est calcule</summary>
            <div className="mt-2 space-y-1 text-muted-foreground">
              <p>
                Ressource: {identity.primary}
                {identity.secondary ? ` (${identity.secondary})` : ''}
              </p>
              <p>Source du prix: {costSourceBadge || mapCostSourceLabel(recommendation.costSource)}</p>
              <p>Hypotheses: on-demand, sans RI/Savings Plans. Conversion USD vers EUR selon taux configure.</p>
              <p>Cout DR additionnel: {money(card.monthlyCost, currency)}/mois ({money(card.annualCost, currency)}/an)</p>
              {isFinancialProfileConfigured && recommendation.calculation ? (
                <>
                  <p>ALE actuel: {money(recommendation.calculation.aleCurrent, currency)}</p>
                  <p>ALE apres DR: {money(recommendation.calculation.aleAfter, currency)}</p>
                  <p>
                    Risque annuel evite:{' '}
                    {recommendation.calculation.riskAvoidedAnnual < 0
                      ? 'Aucun gain - service deja protege'
                      : money(recommendation.calculation.riskAvoidedAnnual, currency)}
                  </p>
                  <p>ROI: {individualRoiDisplay.label}</p>
                </>
              ) : (
                <p>Activez le profil financier pour afficher le calcul ROI detaille.</p>
              )}
            </div>
          </details>
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

      {!recommendationsQuery.isLoading && recommendationCards.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]">
              <div className="space-y-2">
                <Label>Stratégie DR</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      <span className="truncate">Stratégie DR : {strategyFilterLabel(selectedStrategies)}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">Filtrer par stratégie</p>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedStrategies(DEFAULT_STRATEGY_FILTERS)}
                        >
                          Tout
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedStrategies([])}>
                          Aucune
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {STRATEGY_FILTER_OPTIONS.map((option) => (
                        <label
                          key={option.value}
                          className="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                        >
                          <span>{option.label}</span>
                          <Checkbox
                            checked={selectedStrategies.includes(option.value)}
                            onCheckedChange={(checked) => toggleStrategyFilter(option.value, Boolean(checked))}
                            aria-label={`Filtrer ${option.label}`}
                          />
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label htmlFor="recommendations-max-annual-cost">Coût estimé</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    ≤
                  </span>
                  <Input
                    id="recommendations-max-annual-cost"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={maxAnnualCostInput}
                    onChange={(event) => setMaxAnnualCostInput(event.target.value)}
                    className="pl-9"
                    placeholder={`500 ${currency}/an`}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>ROI</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={roiSortDirection === 'asc' ? 'default' : 'outline'}
                    onClick={() => setRoiSortDirection('asc')}
                    aria-label="Trier par ROI croissant"
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={roiSortDirection === 'desc' ? 'default' : 'outline'}
                    onClick={() => setRoiSortDirection('desc')}
                    aria-label="Trier par ROI décroissant"
                  >
                    ↓
                  </Button>
                </div>
              </div>

              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetFilters}
                  disabled={!hasActiveFilters}
                  aria-label="Réinitialiser les filtres"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Réinitialiser
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p>
                {filteredRecommendationCards.length} recommandations affichées sur {recommendationCards.length} total
                {isFinancialProfileConfigured ? ` (dont ${quickWinCards.length} Quick Wins)` : ''}
              </p>
              {filteredOutOfBudgetCount > 0 && (
                <p className="text-muted-foreground">
                  Les cartes hors budget sont estompees, sans modification du cout unitaire.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
              {isFinancialProfileConfigured ? 'ROI de vos recommandations' : 'Budget DR'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-lg border bg-muted/20 p-4 space-y-1">
              {hasConfiguredBudgetCap && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md border bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">Budget DR</p>
                    <p className="font-semibold">{money(summaryBudgetAnnual, currency)}/an</p>
                  </div>
                  <div className="rounded-md border bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">Selectionne</p>
                    <p className="font-semibold">{money(summarySelectedAnnualCost, currency)}/an</p>
                  </div>
                  <div className="rounded-md border bg-background px-3 py-2">
                    <p className="text-xs text-muted-foreground">Restant</p>
                    <p className="font-semibold">
                      {summaryRemainingBudgetAnnual == null ? 'N/A' : `${money(summaryRemainingBudgetAnnual, currency)}/an`}
                    </p>
                  </div>
                </div>
              )}
              <p>
                Recommandations retenues : <span className="font-semibold">{summaryTotalRecommendations}</span>
              </p>
              {summarySecondaryRecommendations > 0 && (
                <p>
                  Secondaires hors cap:{' '}
                  <span className="font-semibold">
                    {summarySecondaryRecommendations} ({money(summarySecondaryAnnualCost, currency)}/an)
                  </span>
                </p>
              )}
              {summaryAnnualCostCap > 0 && recommendationsSummaryQuery.data?.budgetAnnual == null && (
                <p>
                  Cap DR appliqué :{' '}
                  <span className="font-semibold">{money(summaryAnnualCostCap, currency)}/an</span>
                </p>
              )}
              <p>
                Répartition budget DR par stratégie : {Object.entries(recommendationsSummaryQuery.data?.costSharePercentByStrategy ?? {})
                  .map(([strategy, share]) => `${STRATEGY_LABELS[strategy] ?? strategy} : ${Number(share).toFixed(1).replace('.', ',')}%`)
                  .join(' | ') || 'N/A'}
              </p>
              {!isFinancialProfileConfigured && (
                <p className="text-xs text-muted-foreground mt-2">
                  Configurez le profil financier pour afficher ROI, payback et economie annuelle.
                </p>
              )}
              {recommendationsSummaryQuery.data?.financialDisclaimers?.strategy && (
                <p className="text-xs text-muted-foreground mt-2">
                  Source: {recommendationsSummaryQuery.data?.financialDisclaimers?.strategy}
                </p>
              )}
              {roiQuery.data?.disclaimer && !recommendationsSummaryQuery.data?.financialDisclaimers?.strategy && (
                <p className="text-xs text-muted-foreground mt-2">Source: {roiQuery.data.disclaimer}</p>
              )}
            </div>
            {isFinancialProfileConfigured && (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Risque annuel évité"
                  value={summaryRiskAvoidedDisplay}
                  color={summaryRiskAvoided < 0 ? 'text-amber-700' : 'text-green-600'}
                />
                <Metric
                  label="Coût annuel DR"
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
            )}
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
            <p className="text-sm text-muted-foreground">Lancez une analyse pour générer les mesures de résilience.</p>
          </CardContent>
        </Card>
      )}

      {!recommendationsQuery.isLoading &&
        recommendationCards.length > 0 &&
        filteredRecommendationCards.length === 0 && (
          <Card>
            <CardContent className="space-y-3 py-10 text-center">
              <p className="font-medium">Aucune recommandation ne correspond aux filtres actuels</p>
              <p className="text-sm text-muted-foreground">
                 Élargissez le coût maximal, re-sélectionnez des stratégies ou revenez au tri par défaut.
              </p>
              <div>
                <Button type="button" variant="outline" onClick={resetFilters}>
                  Réinitialiser les filtres
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

      {!recommendationsQuery.isLoading && filteredRecommendationCards.length > 0 && (
        <div className="space-y-4">
          {isFinancialProfileConfigured && (
            <section className="space-y-3 rounded-xl border border-green-200 bg-green-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-green-900">
                    Quick Wins & forte valeur ajoutée ({quickWinCards.length})
                  </p>
                  <p className="text-xs text-green-800/80">
                    ROI &gt; 100% avec faible poids budgétaire, ou payback inférieur à 6 mois.
                  </p>
                </div>
                <Badge variant="outline" className="border-green-300 bg-white text-green-700">
                  Trié par ROI {roiSortDirection === 'asc' ? 'croissant' : 'décroissant'}
                </Badge>
              </div>
              <div className="space-y-3">
                {quickWinCards.length === 0 ? (
                  <p className="text-sm text-green-900/80">Aucun Quick Win pour les filtres actifs.</p>
                ) : (
                  quickWinCards.map((card) => renderRecommendationCard(card, true))
                )}
              </div>
            </section>
          )}

          <section className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">
                  {isFinancialProfileConfigured
                    ? `Autres recommandations (${otherRecommendationCards.length})`
                    : `Recommandations (${filteredRecommendationCards.length})`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isFinancialProfileConfigured
                    ? 'Mesures utiles à prioriser après les gains rapides.'
                    : 'Mesures de resilience priorisees selon votre contexte technique.'}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {(isFinancialProfileConfigured ? otherRecommendationCards.length : filteredRecommendationCards.length) === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune autre recommandation pour les filtres actifs.</p>
              ) : (
                (isFinancialProfileConfigured ? otherRecommendationCards : filteredRecommendationCards)
                  .map((card) => renderRecommendationCard(card, false))
              )}
            </div>
          </section>
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


