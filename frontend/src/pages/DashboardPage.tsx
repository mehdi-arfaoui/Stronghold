import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Shield, AlertTriangle, Server, Clock, RefreshCw, FlaskConical, Lightbulb, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/dashboard/StatCard';
import { ResilienceGauge } from '@/components/dashboard/ResilienceGauge';
import { SPOFList } from '@/components/dashboard/SPOFList';
import { RiskMatrix } from '@/components/dashboard/RiskMatrix';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';
import { analysisApi } from '@/api/analysis.api';
import { discoveryApi } from '@/api/discovery.api';
import { risksApi } from '@/api/risks.api';
import { financialApi } from '@/api/financial.api';
import { formatRelativeTime } from '@/lib/formatters';

export function DashboardPage() {
  const navigate = useNavigate();

  const scoreQuery = useQuery({
    queryKey: ['resilience-score'],
    queryFn: async () => (await analysisApi.getResilienceScore()).data,
  });

  const spofsQuery = useQuery({
    queryKey: ['spofs'],
    queryFn: async () => (await analysisApi.getSPOFs()).data,
  });

  const risksQuery = useQuery({
    queryKey: ['risks'],
    queryFn: async () => (await risksApi.getRisks()).data,
  });
  const financialProfileQuery = useQuery({
    queryKey: ['financial-org-profile'],
    queryFn: async () => (await financialApi.getOrgProfile()).data,
    staleTime: 60_000,
  });

  const timelineQuery = useQuery({
    queryKey: ['scan-timeline'],
    queryFn: async () => (await discoveryApi.getScanTimeline(10)).data.entries,
    staleTime: 60_000,
  });

  const isLoading = scoreQuery.isLoading || spofsQuery.isLoading;
  const hasData = scoreQuery.data !== undefined;

  if (isLoading) {
    return <LoadingState message="Chargement du tableau de bord..." />;
  }

  if (!hasData) {
    return (
      <EmptyState
        icon={Shield}
        title="Bienvenue sur Stronghold"
        description="Lancez un premier scan pour decouvrir votre infrastructure et obtenir votre score de resilience."
        actionLabel="Commencer le scan"
        onAction={() => navigate('/')}
      />
    );
  }

  const score = scoreQuery.data;
  const spofs = Array.isArray(spofsQuery.data) ? spofsQuery.data : [];
  const risks = Array.isArray(risksQuery.data) ? risksQuery.data : [];
  const financialMode = financialProfileQuery.data?.mode || 'infra_only';

  if (typeof score?.overall !== 'number') {
    return (
      <EmptyState
        icon={Shield}
        title="Configuration API invalide"
        description="Verifiez VITE_API_URL et la cle API en localStorage (stronghold_api_key)."
        actionLabel="Aller a la decouverte"
        onAction={() => navigate('/')}
      />
    );
  }

  const criticalSpofs = spofs.filter((s) => s.severity === 'critical').length;

  return (
    <div className="space-y-6">
      {/* Row 1: Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Score de resilience"
          value={`${Math.round(score?.overall ?? 0)}/100`}
          icon={Shield}
          trend={score?.trend}
        />
        <StatCard
          title="SPOF detectes"
          value={spofs.length}
          subtitle={criticalSpofs > 0 ? `${criticalSpofs} critique(s)` : undefined}
          icon={AlertTriangle}
        />
        <StatCard
          title="Services critiques"
          value={spofs.filter((s) => s.severity === 'critical' || s.severity === 'high').length}
          icon={Server}
        />
        <StatCard
          title="Dernier scan"
          value={score?.lastCalculated ? formatRelativeTime(score.lastCalculated) : 'N/A'}
          icon={Clock}
        />
      </div>

      {/* Row 2: Gauge + SPOFs */}
      <Card className={financialMode === 'business_profile' ? 'border-emerald-300 bg-emerald-50/50' : 'border-blue-300 bg-blue-50/50'}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          {financialMode === 'business_profile' ? (
            <span>Profil financier configure. Vous pouvez l ajuster a tout moment.</span>
          ) : (
            <span>Profil financier non configure. Configurez-le pour activer l impact business.</span>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate('/settings?tab=finance')}>
            Configurer
          </Button>
        </CardContent>
      </Card>

      {/* Row 2: Gauge + SPOFs */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Score de resilience</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6">
            <ResilienceGauge score={score?.overall ?? 0} size={200} />
            {score?.breakdown && (
              <div className="w-full space-y-2">
                {score.breakdown.map((item) => (
                  <div key={item.category} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className={item.impact < 0 ? 'text-severity-critical' : 'text-resilience-high'}>
                      {item.impact > 0 ? '+' : ''}{item.impact} pts
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <SPOFList spofs={spofs} />
      </div>

      {/* Row 3: Risk matrix */}
      {risks.length > 0 && <RiskMatrix risks={risks} />}

      <Card>
        <CardHeader>
          <CardTitle>Historique scans & drifts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {timelineQuery.isLoading && (
            <p className="text-muted-foreground">Chargement de l historique...</p>
          )}
          {timelineQuery.isError && (
            <p className="text-muted-foreground">Impossible de charger l historique des scans.</p>
          )}
          {!timelineQuery.isLoading && !timelineQuery.isError && (timelineQuery.data || []).length === 0 && (
            <p className="text-muted-foreground">
              Aucun scan historise pour le moment.
            </p>
          )}
          {(timelineQuery.data || []).map((entry) => (
            <div key={entry.id} className="rounded-md border p-3">
              <p className="font-medium">
                {new Date(entry.occurredAt).toLocaleString('fr-FR')} - {entry.type === 'scheduled' ? 'Scan planifie' : 'Scan manuel'}
              </p>
              <p className="text-muted-foreground">
                {entry.nodes} nodes, {entry.edges} edges, {entry.spofCount} SPOF
              </p>
              {entry.driftCount > 0 ? (
                <p className="text-amber-700">
                  {entry.driftCount} drift(s) detecte(s)
                  {entry.drifts[0] ? ` - ${entry.drifts[0].description}` : ''}
                </p>
              ) : (
                <p className="text-emerald-700">Aucun drift detecte</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Row 4: Quick actions */}
      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Button variant="outline" onClick={() => navigate('/discovery')}>
            <RefreshCw className="mr-2 h-4 w-4" /> Relancer un scan
          </Button>
          <Button variant="outline" onClick={() => navigate('/simulations')}>
            <FlaskConical className="mr-2 h-4 w-4" /> Nouvelle simulation
          </Button>
          <Button variant="outline" onClick={() => navigate('/recommendations')}>
            <Lightbulb className="mr-2 h-4 w-4" /> Recommandations
          </Button>
          <Button variant="outline" onClick={() => navigate('/report')}>
            <FileDown className="mr-2 h-4 w-4" /> Generer le rapport
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
