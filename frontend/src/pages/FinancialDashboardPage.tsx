import { useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { financialApi } from '@/api/financial.api';
import { reportsApi } from '@/api/reports.api';
import { ModuleErrorBoundary } from '@/components/ErrorBoundary';
import { FinancialOnboardingWizard } from '@/components/financial/FinancialOnboardingWizard';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import { invalidateFinancialProfileDependentQueries } from '@/lib/financialQueryInvalidation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function KpiCard(props: {
  title: string;
  value: string;
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
}

function FinancialDashboardInner() {
  const queryClient = useQueryClient();
  const tenantScope = getCredentialScopeKey();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardAutoOpened, setWizardAutoOpened] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const orgProfileQuery = useQuery({
    queryKey: ['financial-org-profile', tenantScope],
    queryFn: async () => (await financialApi.getOrgProfile()).data,
    staleTime: 60_000,
  });

  const summaryQuery = useQuery({
    queryKey: ['financial-summary', tenantScope],
    queryFn: async () => (await financialApi.getSummary()).data,
    staleTime: 60_000,
  });

  const trendQuery = useQuery({
    queryKey: ['financial-trend', tenantScope],
    queryFn: async () => (await financialApi.getTrend({ months: 6 })).data,
    staleTime: 60_000,
  });

  const flowCoverageQuery = useQuery({
    queryKey: ['flows-coverage', tenantScope],
    queryFn: async () => (await financialApi.getFlowCoverage()).data,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!orgProfileQuery.isSuccess || wizardAutoOpened) return;
    if (orgProfileQuery.data?.isConfigured === false) {
      setWizardOpen(true);
      setWizardAutoOpened(true);
    }
  }, [orgProfileQuery.data?.isConfigured, orgProfileQuery.isSuccess, wizardAutoOpened]);

  const refreshFinancialData = async () => {
    await invalidateFinancialProfileDependentQueries(queryClient);
  };

  const summary = summaryQuery.data;
  const flowCoverage = flowCoverageQuery.data;
  const lowFlowCoverage = (flowCoverage?.coveragePercent ?? 0) < 50;
  const profileConfigured = orgProfileQuery.data?.isConfigured !== false;
  const currency = summary?.currency || 'EUR';
  const financialPrecision = summary?.financialPrecision;
  const excludedBiaEstimations = summary?.validationScope?.biaExcludedPending ?? 0;
  const paybackMonths = summary?.metrics.paybackMonths ?? -1;
  const paybackValue = paybackMonths > 0 ? `${paybackMonths.toFixed(1)} mois` : 'Non rentable';
  const paybackSubtitle =
    paybackMonths > 0
      ? 'Temps de retour sur investissement'
      : 'Les gains annuels estimes ne couvrent pas les couts';

  const chartData = useMemo(() => {
    if (!summary) return [];
    return [
      {
        name: 'Sans PRA',
        ale: summary.ale.totalALE,
        remediation: 0,
      },
      {
        name: 'Avec PRA Stronghold',
        ale: summary.roi.projectedALE,
        remediation: summary.roi.annualRemediationCost,
      },
    ];
  }, [summary]);

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

  if (summaryQuery.isError || !summary) {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="mb-3 h-10 w-10 text-red-600" />
            <p className="text-base font-semibold">
              Impossible de calculer les estimations financieres.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Verifiez votre profil organisation.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => summaryQuery.refetch()}>Reessayer</Button>
              <Button variant="outline" onClick={() => setWizardOpen(true)}>
                Configurer le profil financier
              </Button>
            </div>
          </CardContent>
        </Card>

        <FinancialOnboardingWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          initialProfile={orgProfileQuery.data}
          onCompleted={refreshFinancialData}
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">ROI & Finance</h1>
          <div className="flex items-center gap-2">
            {!profileConfigured && (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                Profil non configure
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
              Exporter le rapport executif
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)}>
              Configurer le profil financier
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {flowCoverage
            ? `Base sur ${flowCoverage.validatedFlows} flux metier valides couvrant ${flowCoverage.coveragePercent}% de l infrastructure critique.`
            : 'Pilotage financier de la resilience base sur vos SPOFs, BIA et recommandations.'}
        </p>
      </div>

      {!profileConfigured && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">
              Configurez votre profil organisation pour des estimations financieres plus precises.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-500 bg-amber-100 text-amber-900 hover:bg-amber-200"
              onClick={() => setWizardOpen(true)}
            >
              Configurer
            </Button>
          </div>
        </div>
      )}

      {flowCoverage && lowFlowCoverage && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <p className="text-sm font-medium">
            Completez vos flux metier pour des estimations plus precises.
          </p>
        </div>
      )}

      {excludedBiaEstimations > 0 && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-blue-900">
          <p className="text-sm font-medium">
            {excludedBiaEstimations} estimation(s) BIA non validee(s) ne sont pas incluses dans ces calculs.
          </p>
        </div>
      )}

      {financialPrecision && (
        <Card className="border-muted/60">
          <CardHeader>
            <CardTitle className="text-base">
              Precision financiere: {financialPrecision.scorePercent}%
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
                {financialPrecision.breakdown.businessFlowValidated.nodes} noeuds via Business Flows valides (
                {financialPrecision.breakdown.businessFlowValidated.costSharePercent}% du cout total)
              </p>
              <p>
                {financialPrecision.breakdown.userOverride.nodes} noeuds via overrides utilisateur (
                {financialPrecision.breakdown.userOverride.costSharePercent}% du cout total)
              </p>
              <p>
                {financialPrecision.breakdown.estimationEnriched.nodes} noeuds via estimation enrichie (
                {financialPrecision.breakdown.estimationEnriched.costSharePercent}% du cout total)
              </p>
              <p>
                {financialPrecision.breakdown.estimationBase.nodes} noeuds via estimation de base (
                {financialPrecision.breakdown.estimationBase.costSharePercent}% du cout total)
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Risque annuel"
          value={formatMoney(summary.metrics.annualRisk, currency)}
          subtitle={`Perte annuelle attendue (ALE), ${summary.totals.totalSPOFs} SPOFs detectes`}
          icon={ArrowDown}
          tone="risk"
        />
        <KpiCard
          title="Economies potentielles"
          value={formatMoney(summary.metrics.potentialSavings, currency)}
          subtitle="Si les recommandations sont appliquees"
          icon={PiggyBank}
          tone="savings"
        />
        <KpiCard
          title="ROI estime"
          value={formatPercent(summary.metrics.roiPercent)}
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
            Cout du risque vs cout de protection
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
                <Bar dataKey="remediation" name="Remediation annuelle" stackId="cost" fill="#64748b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Reduction de risque estimee: {summary.roi.riskReduction.toFixed(1)}% - source: calcul Stronghold
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top 5 SPOF les plus couteux</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2">Composant</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Dependants</th>
                  <th className="pb-2">Cout/h</th>
                  <th className="pb-2">Risque/an</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summary.topSPOFs.map((spof) => (
                  <tr key={spof.nodeId}>
                    <td className="py-2 font-medium">{spof.nodeName}</td>
                    <td className="py-2">{spof.nodeType}</td>
                    <td className="py-2">{spof.dependentsCount}</td>
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
              Exposition reglementaire
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
                  Deadline de conformite: {formatDate(regulation.complianceDeadline)}
                </p>
                <p className="mt-1">
                  Couverture Stronghold: <strong>{regulation.coverageScore}%</strong>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Source: {regulation.source}</p>
              </div>
            ))}

            {summary.regulatoryExposure?.moduleSignals && (
              <div className="rounded-md border bg-muted/20 p-3">
                <p className="font-medium">Score de couverture simplifie</p>
                <p className="text-muted-foreground">
                  {summary.regulatoryExposure.moduleSignals.completedControls}/
                  {summary.regulatoryExposure.moduleSignals.totalControls} controles actifs
                  ({summary.regulatoryExposure.moduleSignals.coverageScore}%)
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tendance score de resilience vs ALE</CardTitle>
        </CardHeader>
        <CardContent>
          {trendQuery.isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : trendQuery.isError ? (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Impossible de charger la tendance financiere.
            </div>
          ) : !trendQuery.data?.hasEnoughHistory ? (
            <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
              {trendQuery.data?.message ||
                'Lancez des scans reguliers pour visualiser la tendance de votre resilience.'}
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
                      name="Score resilience"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="ale"
                      name="ALE estime"
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
          <CardTitle>Methodologie & Sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">{summary.disclaimer}</p>
          <p className="text-muted-foreground">{summary.ale.disclaimer}</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {summary.sources.slice(0, 8).map((source) => (
              <li key={source}>- {source}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <FinancialOnboardingWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        initialProfile={orgProfileQuery.data}
        onCompleted={refreshFinancialData}
      />
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
