import { memo, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  Clock3,
  DollarSign,
  FileDown,
  Loader2,
  PiggyBank,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { financialApi } from '@/api/financial.api';
import { recommendationsApi } from '@/api/recommendations.api';
import { reportsApi } from '@/api/reports.api';
import { ModuleErrorBoundary } from '@/components/ErrorBoundary';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import { useLicense } from '@/hooks/useLicense';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UpgradePrompt } from '@/components/UpgradePrompt';

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

const ROI_DISPLAY_CAP_ABS = 5_000;
const ROI_DISPLAY_HIGH_THRESHOLD = 1_000;
const STRATEGY_LABELS: Record<string, string> = {
  'backup-restore': 'Backup & Restore',
  backup_restore: 'Backup & Restore',
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

function formatPercentNullable(value: number | null | undefined): { label: string; tooltip?: string } {
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
  return { label: `${bounded.toFixed(1).replace('.', ',')}%` };
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const KpiCard = memo(function KpiCard(props: {
  title: string;
  value: ReactNode;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  tone: 'risk' | 'savings' | 'roi' | 'payback';
}) {
  const toneClass =
    props.tone === 'risk'
      ? 'text-red-600'
      : props.tone === 'savings'
        ? 'text-green-600'
        : props.tone === 'roi'
          ? 'text-blue-600'
          : 'text-amber-600';

  const Icon = props.icon;

  return (
    <Card className="border-muted/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="h-4 w-4" />
          {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${toneClass}`}>{props.value}</div>
        <p className="mt-2 text-xs text-muted-foreground">{props.subtitle}</p>
      </CardContent>
    </Card>
  );
});

function FinancialDashboardInner() {
  const navigate = useNavigate();
  const tenantScope = getCredentialScopeKey();
  const { hasFeature } = useLicense();
  const [isExporting, setIsExporting] = useState(false);
  const canAccessExecutiveDashboard = hasFeature('executive-dashboard');

  const orgProfileQuery = useQuery({
    queryKey: ['financial-org-profile', tenantScope],
    queryFn: async () => (await financialApi.getOrgProfile()).data,
    staleTime: 60_000,
    enabled: canAccessExecutiveDashboard,
  });

  const summaryQuery = useQuery({
    queryKey: ['financial-summary', tenantScope],
    queryFn: async () => (await financialApi.getSummary()).data,
    staleTime: 60_000,
    enabled: canAccessExecutiveDashboard,
  });

  const trendQuery = useQuery({
    queryKey: ['financial-trend', tenantScope],
    queryFn: async () => (await financialApi.getTrend({ months: 6 })).data,
    staleTime: 60_000,
    enabled: canAccessExecutiveDashboard,
  });

  const flowCoverageQuery = useQuery({
    queryKey: ['flows-coverage', tenantScope],
    queryFn: async () => (await financialApi.getFlowCoverage()).data,
    staleTime: 60_000,
    enabled: canAccessExecutiveDashboard,
  });
  const recommendationsSummaryQuery = useQuery({
    queryKey: ['recommendations-summary', tenantScope],
    queryFn: async () => (await recommendationsApi.getSummary()).data,
    staleTime: 60_000,
    enabled: canAccessExecutiveDashboard,
  });

  const summary = summaryQuery.data;
  const flowCoverage = flowCoverageQuery.data;
  const lowFlowCoverage = (flowCoverage?.coveragePercent ?? 0) < 50;
  const businessProfileConfigured = orgProfileQuery.data?.mode === 'business_profile';
  const currency = summary?.currency || 'EUR';
  const financialPrecision = summary?.financialPrecision;
  const excludedBiaEstimations = summary?.validationScope?.biaExcludedPending ?? 0;
  const potentialSavingsRaw = summary?.metrics.potentialSavings ?? 0;
  const annualRisk = Math.max(0, summary?.metrics.annualRisk ?? 0);
  const potentialSavings = Math.min(
    Math.max(0, potentialSavingsRaw),
    annualRisk,
  );
  const annualRemediationCost = Math.max(0, summary?.roi.annualRemediationCost ?? 0);
  const roiPercent = summary?.metrics.roiPercent ?? null;
  const rawPaybackMonths = summary?.metrics.paybackMonths ?? summary?.roi.paybackMonths ?? null;
  const rawPaybackLabel = summary?.roi.paybackLabel;
  let paybackMonths =
    rawPaybackMonths != null && Number.isFinite(rawPaybackMonths) && rawPaybackMonths > 0
      ? rawPaybackMonths
      : null;
  let paybackLabel = rawPaybackLabel?.trim() || undefined;
  if (
    (roiPercent ?? 0) > 0 &&
    (paybackMonths == null || paybackLabel === 'Non rentable') &&
    potentialSavings > 0 &&
    annualRemediationCost > 0
  ) {
    const derived = annualRemediationCost / (potentialSavings / 12);
    if (Number.isFinite(derived) && derived > 0) {
      paybackMonths = Math.round(derived * 10) / 10;
      paybackLabel = paybackMonths > 60 ? '> 60 mois' : undefined;
    }
  }
  if ((roiPercent ?? 0) <= 0 && paybackMonths == null) {
    paybackLabel = 'Non rentable';
  } else if (paybackMonths != null && paybackMonths > 60 && !paybackLabel) {
    paybackLabel = '> 60 mois';
  }
  const roiDisplay = formatPercentNullable(summary?.metrics.roiPercent ?? null);
  const potentialSavingsDisplay =
    potentialSavingsRaw < 0
      ? 'Aucun gain - service déjà protégé'
      : formatMoney(potentialSavings, currency);
  const paybackValue =
    paybackLabel && paybackLabel.length > 0
      ? paybackLabel
      : paybackMonths != null && paybackMonths > 0
        ? `${paybackMonths.toFixed(1).replace('.', ',')} mois`
        : 'Non rentable';
  const paybackSubtitle =
    paybackMonths != null && paybackMonths > 0
      ? 'Temps de retour sur investissement'
      : 'Les gains annuels estimés ne couvrent pas les coûts';
  const chartData = useMemo(() => {
    if (!summary) return [];
    const baselineRisk = Math.max(0, summary.metrics.annualRisk ?? 0);
    const cappedSavings = Math.min(
      Math.max(0, summary.metrics.potentialSavings ?? 0),
      baselineRisk,
    );
    let projectedRisk = Math.max(0, summary.roi.projectedALE ?? 0);
    const remediationCost = Math.max(0, summary.roi.annualRemediationCost ?? 0);
    let withPraTotal = projectedRisk + remediationCost;
    if ((summary.metrics.roiPercent ?? 0) > 100 && withPraTotal >= baselineRisk) {
      projectedRisk = Math.max(0, baselineRisk - cappedSavings);
      withPraTotal = projectedRisk + remediationCost;
      if ((summary.metrics.roiPercent ?? 0) > 1000 && withPraTotal >= baselineRisk / 10) {
        projectedRisk = Math.max(0, baselineRisk / 12 - remediationCost);
      }
    }
    return [
      {
        name: 'Sans PRA',
        ale: baselineRisk,
        remediation: 0,
      },
      {
        name: 'Avec PRA Stronghold',
        ale: projectedRisk,
        remediation: remediationCost,
      },
    ];
  }, [summary]);
  const strategySplitData = useMemo(() => {
    const annualCostByStrategy = recommendationsSummaryQuery.data?.annualCostByStrategy ?? {};
    const shareByStrategy = recommendationsSummaryQuery.data?.costSharePercentByStrategy ?? {};
    return Object.entries(annualCostByStrategy)
      .map(([strategy, annualCost]) => ({
        strategy,
        displayName: STRATEGY_LABELS[strategy] ?? strategy,
        annualCost: Number(annualCost) || 0,
        share: Number(shareByStrategy[strategy] ?? 0),
      }))
      .filter((entry) => entry.annualCost > 0)
      .sort((left, right) => right.annualCost - left.annualCost);
  }, [recommendationsSummaryQuery.data?.annualCostByStrategy, recommendationsSummaryQuery.data?.costSharePercentByStrategy]);
  const strategyShareTotal = strategySplitData.reduce((sum, entry) => sum + entry.share, 0);

  const trendData = useMemo(() => {
    const points = trendQuery.data?.points ?? [];
    return points.map((point) => ({
      ...point,
      scanDateLabel: formatDate(point.scanDate),
    }));
  }, [trendQuery.data?.points]);

  const regulatoryCards = useMemo(() => {
    if (!summary?.regulatoryExposure) return [];
    const direct = summary.regulatoryExposure.applicableRegulations;
    if (Array.isArray(direct) && direct.length > 0) return direct;

    const fallback: Array<{
      id: 'nis2' | 'dora';
      label: string;
      maxFine: string;
      complianceDeadline: string;
      coverageScore: number;
      source: string;
    }> = [];

    if (summary.regulatoryExposure.nis2?.applicable) {
      fallback.push({
        id: 'nis2',
        label: 'NIS2',
        maxFine:
          summary.regulatoryExposure.nis2.maxFine ||
          '10M EUR ou 2% du chiffre d affaires mondial',
        complianceDeadline:
          summary.regulatoryExposure.nis2.complianceDeadline || '2026-10-17',
        coverageScore:
          summary.regulatoryExposure.nis2.coverageScore ||
          summary.regulatoryExposure.coverageScore ||
          0,
        source: summary.regulatoryExposure.nis2.source || 'NIS2 Directive',
      });
    }

    if (summary.regulatoryExposure.dora?.applicable) {
      fallback.push({
        id: 'dora',
        label: 'DORA',
        maxFine:
          summary.regulatoryExposure.dora.maxFine ||
          '1% du CA mondial quotidien moyen par jour',
        complianceDeadline:
          summary.regulatoryExposure.dora.complianceDeadline || '2025-01-17',
        coverageScore:
          summary.regulatoryExposure.dora.coverageScore ||
          summary.regulatoryExposure.coverageScore ||
          0,
        source: summary.regulatoryExposure.dora.source || 'DORA Regulation',
      });
    }

    return fallback;
  }, [summary?.regulatoryExposure]);

  const handleExportExecutivePdf = async () => {
    if (!summary || isExporting) return;
    try {
      setIsExporting(true);
      const response = await reportsApi.generateExecutiveFinancialSummary({
        currency: summary.currency,
      });
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data as BlobPart], { type: 'application/pdf' });

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'executive-financial-summary.pdf';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      toast.success('Rapport executif exporte');
    } catch {
      toast.error('Export PDF impossible');
    } finally {
      setIsExporting(false);
    }
  };

  if (summaryQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canAccessExecutiveDashboard) {
    return <UpgradePrompt feature="Dashboard executif" requiredPlan="Pro" />;
  }

  if (summaryQuery.isError || !summary) {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="mb-3 h-10 w-10 text-red-600" />
            <p className="text-base font-semibold">
              Impossible de calculer les estimations financières.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Verifiez votre profil organisation.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => summaryQuery.refetch()}>Réessayer</Button>
              <Button variant="outline" onClick={() => navigate('/settings?tab=finance')}>
                Configurer le profil financier
              </Button>
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">ROI & Finance</h1>
          <div className="flex items-center gap-2">
            {!businessProfileConfigured && (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                Mode infra uniquement
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportExecutivePdf}
              disabled={isExporting}
            >
              {isExporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="mr-2 h-4 w-4" />
              )}
              Exporter le rapport exécutif
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/settings?tab=finance')}>
              Configurer le profil financier
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {flowCoverage
            ? `Basé sur ${flowCoverage.validatedFlows} flux métier validés couvrant ${flowCoverage.coveragePercent}% de l'infrastructure critique.`
            : 'Pilotage financier de la résilience basé sur vos SPOFs, BIA et recommandations.'}
        </p>
      </div>

      {orgProfileQuery.data?.reviewBanner && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <p className="text-sm font-medium">{orgProfileQuery.data.reviewBanner}</p>
        </div>
      )}
      {!orgProfileQuery.data?.reviewBanner && !businessProfileConfigured && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {orgProfileQuery.data?.inferenceBanner ||
                'Calculs basés sur les coûts d’infrastructure uniquement. Configurez votre profil financier pour l’impact business.'}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-500 bg-amber-100 text-amber-900 hover:bg-amber-200"
              onClick={() => navigate('/settings?tab=finance')}
            >
              Configurer
            </Button>
          </div>
        </div>
      )}
      {businessProfileConfigured && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">Profil financier configuré.</p>
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-500 bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
              onClick={() => navigate('/settings?tab=finance')}
            >
              Modifier
            </Button>
          </div>
        </div>
      )}

      {flowCoverage && lowFlowCoverage && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <p className="text-sm font-medium">
            Complétez vos flux métier pour des estimations plus précises.
          </p>
        </div>
      )}

      {excludedBiaEstimations > 0 && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-blue-900">
          <p className="text-sm font-medium">
            {excludedBiaEstimations} estimation(s) BIA non validée(s) ne sont pas incluses dans ces calculs.
          </p>
        </div>
      )}

      {financialPrecision && (
        <Card className="border-muted/60">
          <CardHeader>
            <CardTitle className="text-base">
              Précision financière : {financialPrecision.scorePercent}%
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, financialPrecision.scorePercent))}%` }}
              />
            </div>
            <div className="space-y-1 text-sm">
              <p>
                Précision coûts infra : {financialPrecision.infraCostPrecisionPercent}/50
              </p>
              <p>
                Précision profil business : {financialPrecision.businessProfilePrecisionPercent}/50
              </p>
              <p>
                [Prix réel ✓✓] : {financialPrecision.breakdown.pricingSources.costExplorer.costSharePercent}% du coût
                infra
              </p>
              <p>
                [Prix API ✓] : {financialPrecision.breakdown.pricingSources.pricingApi.costSharePercent}% du coût
                infra
              </p>
              <p>
                [Estimation ≈] : {financialPrecision.breakdown.pricingSources.staticTable.costSharePercent}% du coût
                infra
              </p>
              <p>
                Niveau profil business : {financialPrecision.breakdown.businessProfile.level}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Risque annuel"
          value={formatMoney(annualRisk, currency)}
          subtitle={`Perte annuelle attendue (ALE), ${summary.totals.totalSPOFs} SPOFs détectés`}
          icon={ArrowDown}
          tone="risk"
        />
        <KpiCard
          title="Économies potentielles"
          value={potentialSavingsDisplay}
          subtitle="Si les recommandations sont appliquées"
          icon={PiggyBank}
          tone={potentialSavingsRaw < 0 ? 'payback' : 'savings'}
        />
        <KpiCard
          title="ROI estimé"
          value={<span title={roiDisplay.tooltip}>{roiDisplay.label}</span>}
          subtitle="Retour sur investissement annuel net"
          icon={TrendingUp}
          tone="roi"
        />
        <KpiCard
          title="Payback"
          value={paybackValue}
          subtitle={paybackSubtitle}
          icon={Clock3}
          tone="payback"
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Coût du risque vs coût de protection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip
                  formatter={(value) => formatMoney(Number(value ?? 0), currency)}
                  contentStyle={{ borderRadius: 12 }}
                />
                <Legend />
                <Bar dataKey="ale" name="ALE" stackId="cost" fill="#ef4444" />
                <Bar dataKey="remediation" name="Remédiation annuelle" stackId="cost" fill="#64748b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Réduction de risque estimée : {summary.roi.riskReduction.toFixed(1).replace('.', ',')}% - source : calcul Stronghold
          </p>
        </CardContent>
      </Card>
      {strategySplitData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Répartition budget DR par stratégie</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={strategySplitData}
                    dataKey="annualCost"
                    nameKey="displayName"
                    innerRadius={55}
                    outerRadius={95}
                    label={(entry: any) =>
                      `${String(entry?.displayName || '')} ${Number(entry?.share ?? 0).toFixed(1).replace('.', ',')}%`
                    }
                  >
                    {strategySplitData.map((entry, index) => (
                      <Cell
                        key={`${entry.strategy}-${index}`}
                        fill={['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'][index % 5]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatMoney(Number(value), currency)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 text-sm">
              {strategySplitData.map((entry) => (
                <div key={entry.strategy} className="rounded border px-3 py-2">
                  <p className="font-medium">{entry.displayName}</p>
                  <p className="text-muted-foreground">
                    {formatMoney(entry.annualCost, currency)} / an ({entry.share.toFixed(1).replace('.', ',')}%)
                  </p>
                </div>
              ))}
              <p className="text-xs font-medium text-muted-foreground">Total affiché : {strategyShareTotal.toFixed(0)}%</p>
              <p className="text-xs text-muted-foreground">
                Budget DR estimé : {formatMoney(recommendationsSummaryQuery.data?.budgetAnnual ?? 0, currency)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Top 5 SPOF les plus coûteux</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2">Composant</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Dépendants</th>
                  <th className="pb-2">Coût/mois</th>
                  <th className="pb-2">Source prix</th>
                  <th className="pb-2">Coût/h</th>
                  <th className="pb-2">Risque/an</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summary.topSPOFs.map((spof) => (
                  <tr key={spof.nodeId}>
                    <td className="py-2 font-medium">{spof.nodeName}</td>
                    <td className="py-2">{spof.nodeType}</td>
                    <td className="py-2">{spof.dependentsCount}</td>
                    <td className="py-2">
                      {spof.monthlyCost != null ? formatMoney(spof.monthlyCost, currency) : 'N/A'}
                    </td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs">
                        {spof.monthlyCostSourceLabel || '[Estimation ≈]'}
                      </span>
                    </td>
                    <td className="py-2">{formatMoney(spof.costPerHour, currency)}</td>
                    <td className="py-2 font-semibold text-red-600">
                      {formatMoney(spof.ale, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {regulatoryCards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              Exposition réglementaire
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {regulatoryCards.map((regulation) => (
              <div
                key={regulation.id}
                className="rounded-lg border border-amber-200 bg-amber-50 p-3"
              >
                <p className="font-semibold">{regulation.label}</p>
                <p className="text-muted-foreground">Amende max: {regulation.maxFine}</p>
                <p className="text-muted-foreground">
                  Deadline de conformité : {formatDate(regulation.complianceDeadline)}
                </p>
                <p className="mt-1">
                  Couverture Stronghold: <strong>{regulation.coverageScore}%</strong>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Source: {regulation.source}</p>
              </div>
            ))}

            {summary.regulatoryExposure?.moduleSignals && (
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="font-medium">Score de couverture simplifié</p>
                <p className="text-muted-foreground">
                  {summary.regulatoryExposure.moduleSignals.completedControls}/
                  {summary.regulatoryExposure.moduleSignals.totalControls} contrôles actifs
                  ({summary.regulatoryExposure.moduleSignals.coverageScore}%)
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tendance score de résilience vs ALE</CardTitle>
        </CardHeader>
        <CardContent>
          {trendQuery.isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : trendQuery.isError ? (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Impossible de charger la tendance financière.
            </div>
          ) : !trendQuery.data?.hasEnoughHistory ? (
            <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
              {trendQuery.data?.message ||
                'Lancez des scans réguliers pour visualiser la tendance de votre résilience.'}
            </div>
          ) : (
            <>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="scanDateLabel" />
                    <YAxis yAxisId="left" domain={[0, 100]} />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickFormatter={(value) => formatCompactMoney(Number(value), currency)}
                    />
                    <Tooltip
                      formatter={(value, key) => {
                        if (key === 'ale') return formatMoney(Number(value), currency);
                        return String(value);
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="resilienceScore"
                      name="Score résilience"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="ale"
                      name="ALE estimé"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                    {trendData
                      .filter((point) => point.criticalDriftCount > 0)
                      .map((point) => (
                        <ReferenceDot
                          key={point.analysisId}
                          yAxisId="right"
                          x={point.scanDateLabel}
                          y={point.ale}
                          r={6}
                          fill="#dc2626"
                          stroke="#991b1b"
                          label={{
                            value: `Drift +${formatCompactMoney(point.criticalDriftAdditionalRisk, currency)}/an`,
                            position: 'top',
                            fill: '#991b1b',
                            fontSize: 10,
                          }}
                        />
                      ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {trendData
                  .flatMap((point) => point.annotations.slice(0, 1))
                  .slice(0, 4)
                  .map((annotation) => (
                    <p key={annotation.driftId}>- {annotation.label}</p>
                  ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Méthodologie & Sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">{summary.disclaimer}</p>
          <p className="text-muted-foreground">{summary.ale.disclaimer}</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {summary.sources.slice(0, 8).map((source) => (
              <li key={source}>- {source}</li>
            ))}
          </ul>
          {recommendationsSummaryQuery.data?.financialDisclaimers && (
            <div className="rounded border bg-muted/20 p-3 text-xs text-muted-foreground">
              <p>Stratégies DR : {recommendationsSummaryQuery.data.financialDisclaimers.strategy}</p>
              <p>Probabilités : {recommendationsSummaryQuery.data.financialDisclaimers.probability}</p>
              <p>Coûts infra : {recommendationsSummaryQuery.data.financialDisclaimers.serviceCost}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function FinancialDashboardPage() {
  return (
    <ModuleErrorBoundary moduleName="Financial Dashboard">
      <FinancialDashboardInner />
    </ModuleErrorBoundary>
  );
}


