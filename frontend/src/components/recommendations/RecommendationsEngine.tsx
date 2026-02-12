import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Lightbulb,
  List,
  BarChart3,
  DollarSign,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Star,
  Shield,
  Clock,
  Loader2,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/formatters';
import { api } from '@/api/client';
import { recommendationsApi, type Recommendation } from '@/api/recommendations.api';
import { roiApi, type ROIReport } from '@/api/roi.api';

type ViewMode = 'list' | 'matrix';
type SortField = 'priority' | 'cost' | 'roi';

const REJECTION_REASONS = [
  { value: 'out_of_budget', label: 'Hors budget' },
  { value: 'not_priority', label: 'Non prioritaire' },
  { value: 'already_covered', label: 'Deja couvert' },
  { value: 'other', label: 'Autre' },
] as const;

const CURRENCIES: { value: string; label: string; symbol: string }[] = [
  { value: 'EUR', label: 'EUR', symbol: '\u20AC' },
  { value: 'USD', label: 'USD', symbol: '$' },
  { value: 'GBP', label: 'GBP', symbol: '\u00A3' },
  { value: 'CHF', label: 'CHF', symbol: 'CHF' },
  { value: 'CAD', label: 'CAD', symbol: 'C$' },
  { value: 'JPY', label: 'JPY', symbol: '\u00A5' },
];

const STRATEGY_INFO: Record<string, { label: string; description: string; color: string }> = {
  'active-active': {
    label: 'Active-Active',
    description: 'Redondance totale avec basculement instantane',
    color: 'bg-severity-critical/10 text-severity-critical',
  },
  'warm-standby': {
    label: 'Warm Standby',
    description: 'Instance de secours pre-configuree, basculement rapide',
    color: 'bg-severity-high/10 text-severity-high',
  },
  'pilot-light': {
    label: 'Pilot Light',
    description: 'Configuration minimale prete a etre escaladee',
    color: 'bg-severity-medium/10 text-severity-medium',
  },
  'backup': {
    label: 'Backup & Restore',
    description: 'Sauvegardes regulieres avec restauration manuelle',
    color: 'bg-severity-low/10 text-severity-low',
  },
};

interface RecommendationsEngineProps {
  className?: string;
}


const priorityBadgeClass: Record<string, string> = {
  P0: 'bg-red-500/10 text-red-700 border-red-500/20',
  P1: 'bg-orange-500/10 text-orange-700 border-orange-500/20',
  P2: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
  P3: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
};

function getSourceLabel(source?: string) {
  if (source === 'rule') return '🔧 Regle';
  if (source === 'normative') return '📋 Norme';
  if (source === 'ai') return '🤖 IA';
  return '🔧 Regle';
}

function getConfidenceLabel(confidence?: string) {
  if (confidence === 'high') return '🟢 Haute';
  if (confidence === 'medium') return '🟡 Moyenne';
  return '🔴 Faible';
}

export function RecommendationsEngine({ className }: RecommendationsEngineProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [currency, setCurrency] = useState('EUR');
  const [sortBy, setSortBy] = useState<SortField>('priority');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('not_priority');
  const [rejectNote, setRejectNote] = useState('');
  // Track local overrides for optimistic UI (accepted/rejected status + animation)
  const [localOverrides, setLocalOverrides] = useState<Map<string, { accepted: boolean; notes?: string }>>(new Map());

  // Fetch live exchange rates from backend
  const ratesQuery = useQuery({
    queryKey: ['currency-rates', currency],
    queryFn: async () => {
      const { data } = await api.get<{ rates: Record<string, number>; cachedAt: string; source: string }>(
        `/currencies/rates?base=EUR`
      );
      return data;
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  const recsQuery = useQuery({
    queryKey: ['recommendations'],
    queryFn: async () => (await recommendationsApi.getAll()).data,
  });

  const hybridQuery = useQuery({
    queryKey: ['recommendations-hybrid'],
    queryFn: async () => (await recommendationsApi.getHybrid()).data.recommendations ?? [],
  });

  const summaryQuery = useQuery({
    queryKey: ['recommendations-summary'],
    queryFn: async () => (await recommendationsApi.getSummary()).data,
  });

  const roiQuery = useQuery({
    queryKey: ['roi-report', currency],
    queryFn: async () => (await roiApi.getROI({ currency })).data,
    staleTime: 5 * 60 * 1000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, accepted, notes }: { id: string; accepted: boolean; notes?: string }) =>
      recommendationsApi.updateStatus(id, { accepted, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['recommendations-summary'] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => recommendationsApi.resetStatus(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['recommendations-summary'] });
    },
  });

  const handleAccept = useCallback((rec: Recommendation) => {
    const prevState = localOverrides.get(rec.id);
    setLocalOverrides((prev) => {
      const next = new Map(prev);
      next.set(rec.id, { accepted: true });
      return next;
    });

    updateMutation.mutate({ id: rec.id, accepted: true });

    toast.success(`"${rec.serviceName ?? rec.title ?? 'Recommandation'}" integree au plan`, {
      duration: 5000,
      action: {
        label: 'Annuler',
        onClick: () => {
          setLocalOverrides((prev) => {
            const next = new Map(prev);
            if (prevState) {
              next.set(rec.id, prevState);
            } else {
              next.delete(rec.id);
            }
            return next;
          });
          resetMutation.mutate(rec.id);
        },
      },
    });
  }, [localOverrides, updateMutation, resetMutation]);

  const handleRejectConfirm = useCallback((rec: Recommendation) => {
    const reasonLabel = REJECTION_REASONS.find((r) => r.value === rejectReason)?.label ?? rejectReason;
    const notes = rejectNote ? `${reasonLabel}: ${rejectNote}` : reasonLabel;

    const prevState = localOverrides.get(rec.id);
    setLocalOverrides((prev) => {
      const next = new Map(prev);
      next.set(rec.id, { accepted: false, notes });
      return next;
    });

    updateMutation.mutate({ id: rec.id, accepted: false, notes });
    setRejectingId(null);
    setRejectReason('not_priority');
    setRejectNote('');

    toast(`"${rec.serviceName ?? rec.title ?? 'Recommandation'}" rejetee — ${reasonLabel}`, {
      duration: 5000,
      action: {
        label: 'Annuler',
        onClick: () => {
          setLocalOverrides((prev) => {
            const next = new Map(prev);
            if (prevState) {
              next.set(rec.id, prevState);
            } else {
              next.delete(rec.id);
            }
            return next;
          });
          resetMutation.mutate(rec.id);
        },
      },
    });
  }, [localOverrides, rejectReason, rejectNote, updateMutation]);

  const recs = useMemo(() => {
    const data = recsQuery.data ?? [];
    return [...data].sort((a: Recommendation, b: Recommendation) => {
      if (sortBy === 'cost') return (a.estimatedCost ?? 0) - (b.estimatedCost ?? 0);
      if (sortBy === 'roi') return (b.roi ?? 0) - (a.roi ?? 0);
      return Number(a.priority ?? 0) - Number(b.priority ?? 0);
    });
  }, [recsQuery.data, sortBy]);

  const summary = summaryQuery.data;
  const currencyInfo = CURRENCIES.find((c) => c.value === currency) ?? CURRENCIES[0];
  const liveRates = ratesQuery.data;

  const formatAmount = (amount: number) => {
    // Use live rates from backend if available, fall back to defaults
    const defaultRates: Record<string, number> = { EUR: 1, USD: 1.08, GBP: 0.86, CHF: 0.94, CAD: 1.47, JPY: 162 };
    const rates = liveRates?.rates ?? defaultRates;
    const rate = rates[currency] ?? 1;
    const converted = amount * rate;
    if (converted >= 1000000) return `${currencyInfo.symbol}${(converted / 1000000).toFixed(1)}M`;
    if (converted >= 1000) return `${currencyInfo.symbol}${(converted / 1000).toFixed(0)}K`;
    return `${currencyInfo.symbol}${Math.round(converted)}`;
  };

  const getEffectiveStatus = (rec: Recommendation): boolean | null => {
    const override = localOverrides.get(rec.id);
    if (override) return override.accepted;
    return rec.accepted ?? null;
  };

  const isLoading = recsQuery.isLoading;

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Lightbulb className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recommandations IA</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Currency Selector with live rates indicator */}
          <div className="flex items-center gap-1.5">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-[100px]" aria-label="Devise">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label} {c.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {liveRates && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground cursor-default">
                    <RefreshCw className="h-3 w-3" />
                    {liveRates.source === 'live' ? 'Live' : liveRates.source === 'cache' ? 'Cache' : 'Defaut'}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Taux mis a jour {formatRelativeTime(liveRates.cachedAt)}</p>
                  <p className="text-xs text-muted-foreground">Source: {liveRates.source}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Sort */}
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortField)}>
            <SelectTrigger className="w-[130px]" aria-label="Trier par">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">Priorite</SelectItem>
              <SelectItem value="cost">Cout</SelectItem>
              <SelectItem value="roi">ROI</SelectItem>
            </SelectContent>
          </Select>

          {/* View Toggle */}
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('list')}
              className="rounded-r-none"
              aria-label="Vue liste"
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'matrix' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('matrix')}
              className="rounded-l-none"
              aria-label="Vue matrice"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>


      {hybridQuery.data && hybridQuery.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recommandations hybrides (regles + normes)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {hybridQuery.data.map((item) => {
              const priority = typeof item.priority === 'string' ? item.priority : 'P3';
              return (
                <div key={item.id} className="rounded-lg border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={priorityBadgeClass[priority] ?? priorityBadgeClass.P3}>{priority}</Badge>
                    <Badge variant="secondary">{getSourceLabel(item.source)}</Badge>
                    <Badge variant="secondary">{getConfidenceLabel(item.confidence)}</Badge>
                    {item.normativeReference && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="cursor-help">📎 Ref</Badge>
                        </TooltipTrigger>
                        <TooltipContent>{item.normativeReference}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <p className="text-sm font-medium">{item.title ?? item.serviceName ?? 'Recommandation'}</p>
                  <p className="text-sm text-muted-foreground">{item.description ?? 'Aucune description.'}</p>
                  <p className="mt-1 text-sm">Action: {item.action ?? item.notes ?? 'Non precisee.'}</p>
                  <div className="mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const ids = item.affectedNodeIds ?? [];
                        const query = ids.length > 0 ? `?focus=${ids.join(',')}` : '';
                        navigate(`/discovery${query}`);
                      }}
                    >
                      Voir dans le graphe
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <DollarSign className="h-8 w-8 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Cout total estime</p>
                <p className="text-xl font-bold">{formatAmount(summary.totalCost)}<span className="text-sm text-muted-foreground">/mois</span></p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Lightbulb className="h-8 w-8 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Recommandations</p>
                <p className="text-xl font-bold">{summary.totalRecommendations}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <BarChart3 className="h-8 w-8 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Strategies</p>
                <p className="text-xl font-bold">{Object.keys(summary.byStrategy).length}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ROI Analysis */}
      {roiQuery.data && roiQuery.data.riskDetails.spofCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              ROI de vos recommandations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Risque annuel actuel</p>
                <p className="text-lg font-bold text-red-600">
                  {formatAmount(roiQuery.data.breakdown.currentAnnualRisk)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {roiQuery.data.riskDetails.spofCount} SPOF, RTO moy. {roiQuery.data.riskDetails.avgRtoHours}h
                </p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Cout remediation annuel</p>
                <p className="text-lg font-bold">
                  {formatAmount(roiQuery.data.breakdown.annualRemediationCost)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatAmount(roiQuery.data.remediationDetails.totalMonthlyCost)}/mois
                </p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">ROI net annuel</p>
                <p className="text-lg font-bold text-green-600">
                  {formatAmount(roiQuery.data.breakdown.netBenefit)}
                </p>
                <p className="text-xs text-muted-foreground">
                  ROI: {roiQuery.data.roiPercentage}%
                </p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Retour sur investissement</p>
                <p className="text-lg font-bold">
                  {roiQuery.data.paybackPeriodMonths < 12
                    ? `${roiQuery.data.paybackPeriodMonths} mois`
                    : `${Math.round(roiQuery.data.paybackPeriodMonths / 12 * 10) / 10} ans`
                  }
                </p>
              </div>
            </div>

            {/* Compliance Coverage */}
            {Object.keys(roiQuery.data.complianceCoverage).length > 0 && (
              <div className="flex gap-3 flex-wrap">
                {Object.entries(roiQuery.data.complianceCoverage).map(([name, cov]) => (
                  <Tooltip key={name}>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="cursor-help">
                        {name} : {cov.percentage}%
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{cov.covered}/{cov.total} clauses adressees</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Methodologie : {roiQuery.data.methodology.downtimeCostSource}. {roiQuery.data.methodology.riskReductionAssumption}. {roiQuery.data.methodology.disclaimer}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && !isLoading && (
        <div className="space-y-3">
          {recs.map((rec: Recommendation, index: number) => {
            const isExpanded = expandedId === rec.id;
            const strategyInfo = rec.strategy ? STRATEGY_INFO[rec.strategy] : undefined;
            const isTopPriority = index < 3;

            return (
              <Card
                key={rec.id}
                className={cn(
                  'transition-all duration-200',
                  isTopPriority && 'ring-1 ring-primary/20'
                )}
              >
                <CardContent className="p-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4">
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        {isTopPriority && (
                          <Badge className="bg-primary/10 text-primary text-xs gap-1">
                            <Star className="h-3 w-3" /> Top Priorite
                          </Badge>
                        )}
                        <h3 className="font-semibold">{rec.serviceName ?? rec.title ?? rec.id}</h3>
                        <Badge variant="outline">Tier {rec.tier}</Badge>
                        {strategyInfo && (
                          <Badge className={strategyInfo.color}>{strategyInfo.label}</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{rec.description}</p>
                      <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3.5 w-3.5" />
                          {formatAmount(rec.estimatedCost ?? 0)}/mois
                        </span>
                        <span className="flex items-center gap-1">
                          <TrendingUp className="h-3.5 w-3.5" />
                          ROI: {rec.roi ?? 0}x
                        </span>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      {(() => {
                        const status = getEffectiveStatus(rec);
                        if (status === null) {
                          return (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleAccept(rec)}
                                disabled={updateMutation.isPending}
                                className="transition-all duration-200 hover:border-resilience-high hover:text-resilience-high"
                              >
                                <Check className="mr-1 h-3.5 w-3.5" /> Accepter
                              </Button>
                              <div className="relative">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setRejectingId(rejectingId === rec.id ? null : rec.id)}
                                  disabled={updateMutation.isPending}
                                >
                                  <X className="mr-1 h-3.5 w-3.5" /> Rejeter
                                </Button>

                                {/* Rejection reason popover */}
                                {rejectingId === rec.id && (
                                  <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-lg border bg-popover p-4 shadow-lg">
                                    <p className="mb-2 text-sm font-medium">Raison du refus</p>
                                    <Select value={rejectReason} onValueChange={setRejectReason}>
                                      <SelectTrigger className="w-full mb-2" aria-label="Raison">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {REJECTION_REASONS.map((r) => (
                                          <SelectItem key={r.value} value={r.value}>
                                            {r.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {rejectReason === 'other' && (
                                      <input
                                        type="text"
                                        placeholder="Preciser..."
                                        value={rejectNote}
                                        onChange={(e) => setRejectNote(e.target.value)}
                                        className="mb-2 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
                                      />
                                    )}
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="flex-1"
                                        onClick={() => setRejectingId(null)}
                                      >
                                        Annuler
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="flex-1"
                                        onClick={() => handleRejectConfirm(rec)}
                                      >
                                        Confirmer
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </>
                          );
                        }
                        return (
                          <Badge
                            variant={status ? 'default' : 'secondary'}
                            className={cn(
                              'transition-all duration-300',
                              status && 'bg-resilience-high/10 text-resilience-high border-resilience-high'
                            )}
                          >
                            {status ? 'Integree au plan' : 'Rejetee'}
                          </Badge>
                        );
                      })()}
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && strategyInfo && (
                    <div className="mt-4 pt-4 border-t space-y-4">
                      <div className="rounded-lg bg-muted/50 p-4">
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                          <Shield className="h-4 w-4" />
                          Strategie: {strategyInfo.label}
                        </h4>
                        <p className="text-sm text-muted-foreground">{strategyInfo.description}</p>
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div className="text-center p-3 rounded-lg border">
                          <DollarSign className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                          <p className="font-bold">{formatAmount(rec.estimatedCost ?? 0)}</p>
                          <p className="text-xs text-muted-foreground">par mois</p>
                        </div>
                        <div className="text-center p-3 rounded-lg border">
                          <TrendingUp className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                          <p className="font-bold">{rec.roi ?? 0}x</p>
                          <p className="text-xs text-muted-foreground">ROI estime</p>
                        </div>
                        <div className="text-center p-3 rounded-lg border">
                          <Clock className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                          <p className="font-bold">Tier {rec.tier}</p>
                          <p className="text-xs text-muted-foreground">Priorite</p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Matrix View (Impact/Effort scatter) */}
      {viewMode === 'matrix' && !isLoading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Matrice Impact / Effort</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative h-[400px] border rounded-lg bg-muted/20 p-4">
              {/* Quadrant Labels */}
              <div className="absolute top-2 left-4 text-xs text-muted-foreground">Quick Wins</div>
              <div className="absolute top-2 right-4 text-xs text-muted-foreground">Projets Strategiques</div>
              <div className="absolute bottom-2 left-4 text-xs text-muted-foreground">Nice to Have</div>
              <div className="absolute bottom-2 right-4 text-xs text-muted-foreground">A eviter</div>

              {/* Axes */}
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 text-xs text-muted-foreground whitespace-nowrap">
                Impact (reduction du risque)
              </div>
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs text-muted-foreground">
                Effort (cout + complexite)
              </div>

              {/* Crosshair */}
              <div className="absolute top-1/2 left-8 right-4 h-px bg-border" />
              <div className="absolute left-1/2 top-4 bottom-8 w-px bg-border" />

              {/* Points */}
              {recs.map((rec: Recommendation) => {
                const maxCost = Math.max(...recs.map((r: Recommendation) => r.estimatedCost ?? 0), 1);
                const effortPercent = Math.min(((rec.estimatedCost ?? 0) / maxCost) * 80 + 10, 90);
                const impactPercent = Math.min((rec.roi ?? 0) * 20 + 10, 90);
                const strategyInfo = rec.strategy ? STRATEGY_INFO[rec.strategy] : undefined;

                return (
                  <Tooltip key={rec.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'absolute w-6 h-6 rounded-full border-2 transition-all duration-200 hover:scale-125 focus-visible:ring-2 focus-visible:ring-ring',
                          rec.strategy === 'active-active' ? 'bg-severity-critical/30 border-severity-critical' :
                          rec.strategy === 'warm-standby' ? 'bg-severity-high/30 border-severity-high' :
                          rec.strategy === 'pilot-light' ? 'bg-severity-medium/30 border-severity-medium' :
                          'bg-severity-low/30 border-severity-low'
                        )}
                        style={{
                          left: `${effortPercent}%`,
                          bottom: `${impactPercent}%`,
                          transform: 'translate(-50%, 50%)',
                        }}
                        onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                        aria-label={`${rec.serviceName ?? rec.title ?? rec.id} — ${strategyInfo?.label ?? "Strategie"}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-medium">{rec.serviceName ?? rec.title ?? rec.id}</p>
                      <p className="text-xs">Cout: {formatAmount(rec.estimatedCost ?? 0)}/mois — ROI: {rec.roi ?? 0}x</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && recs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Lightbulb className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="font-semibold">Aucune recommandation</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Les recommandations seront generees apres l'analyse de votre infrastructure.
          </p>
        </div>
      )}
    </div>
  );
}
