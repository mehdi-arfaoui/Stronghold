import { useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  Clock3,
  DollarSign,
  Loader2,
  PiggyBank,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { financialApi } from '@/api/financial.api';
import { ModuleErrorBoundary } from '@/components/ErrorBoundary';
import { FinancialOnboardingWizard } from '@/components/financial/FinancialOnboardingWizard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardAutoOpened, setWizardAutoOpened] = useState(false);

  const orgProfileQuery = useQuery({
    queryKey: ['financial-org-profile'],
    queryFn: async () => (await financialApi.getOrgProfile()).data,
    staleTime: 60_000,
  });

  const summaryQuery = useQuery({
    queryKey: ['financial-summary'],
    queryFn: async () => (await financialApi.getSummary()).data,
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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['financial-org-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['financial-summary'] }),
    ]);
  };

  const summary = summaryQuery.data;
  const profileConfigured = orgProfileQuery.data?.isConfigured !== false;

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

  const currency = summary.currency || 'EUR';

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
            <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)}>
              Configurer le profil financier
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Pilotage financier de la resilience base sur vos SPOFs, BIA et recommandations.
        </p>
      </div>

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
          value={`${summary.metrics.paybackMonths.toFixed(1)} mois`}
          subtitle="Temps de retour sur investissement"
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
            Reduction de risque estimee: {summary.roi.riskReduction.toFixed(1)}%
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

      {(summary.regulatoryExposure?.nis2?.applicable || summary.regulatoryExposure?.dora?.applicable) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Exposition reglementaire estimee
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {summary.regulatoryExposure?.nis2?.applicable && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="font-semibold">NIS2</p>
                <p className="text-muted-foreground">
                  Amende maximale: 10M EUR ou 2% du chiffre d'affaires mondial.
                </p>
                <Badge variant="outline" className="mt-2">Applicable</Badge>
              </div>
            )}
            {summary.regulatoryExposure?.dora?.applicable && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="font-semibold">DORA</p>
                <p className="text-muted-foreground">
                  Applicable au secteur financier depuis le 17 janvier 2025.
                </p>
                <Badge variant="outline" className="mt-2">Applicable</Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
