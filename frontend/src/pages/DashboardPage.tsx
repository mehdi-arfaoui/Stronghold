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
import { risksApi } from '@/api/risks.api';
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
  const spofs = spofsQuery.data ?? [];
  const risks = risksQuery.data ?? [];
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
