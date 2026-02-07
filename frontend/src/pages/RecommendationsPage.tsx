import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X, DollarSign, BarChart3, Lightbulb } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/dashboard/StatCard';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';
import { formatCurrency } from '@/lib/formatters';
import { recommendationsApi, type Recommendation } from '@/api/recommendations.api';

const STRATEGY_LABELS: Record<string, string> = {
  'active-active': 'Active-Active',
  'warm-standby': 'Warm Standby',
  'pilot-light': 'Pilot Light',
  'backup': 'Backup & Restore',
};

const STRATEGY_COLORS: Record<string, string> = {
  'active-active': 'bg-severity-critical/10 text-severity-critical',
  'warm-standby': 'bg-severity-high/10 text-severity-high',
  'pilot-light': 'bg-severity-medium/10 text-severity-medium',
  'backup': 'bg-severity-low/10 text-severity-low',
};

export function RecommendationsPage() {
  const queryClient = useQueryClient();

  const recsQuery = useQuery({
    queryKey: ['recommendations'],
    queryFn: async () => (await recommendationsApi.getAll()).data,
  });

  const summaryQuery = useQuery({
    queryKey: ['recommendations-summary'],
    queryFn: async () => (await recommendationsApi.getSummary()).data,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, accepted }: { id: string; accepted: boolean }) =>
      recommendationsApi.updateStatus(id, { accepted }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['recommendations-summary'] });
      toast.success('Recommandation mise a jour');
    },
  });

  if (recsQuery.isLoading) return <LoadingState message="Chargement des recommandations..." />;

  const recs = recsQuery.data ?? [];
  const summary = summaryQuery.data;

  if (recs.length === 0) {
    return (
      <EmptyState
        icon={Lightbulb}
        title="Aucune recommandation"
        description="Les recommandations seront generees apres l'analyse de votre infrastructure."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="Cout total estime" value={formatCurrency(summary.totalCost)} icon={DollarSign} />
          <StatCard title="Recommandations" value={summary.totalRecommendations} icon={Lightbulb} />
          <StatCard title="Strategies" value={Object.keys(summary.byStrategy).length} icon={BarChart3} />
        </div>
      )}

      {/* Recommendations list */}
      <div className="space-y-4">
        {recs.sort((a: Recommendation, b: Recommendation) => a.priority - b.priority).map((rec: Recommendation) => (
          <Card key={rec.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{rec.serviceName}</h3>
                    <Badge variant="outline">Tier {rec.tier}</Badge>
                    <Badge className={STRATEGY_COLORS[rec.strategy] || ''}>
                      {STRATEGY_LABELS[rec.strategy] || rec.strategy}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{rec.description}</p>
                  <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
                    <span>Cout: {formatCurrency(rec.estimatedCost)}/mois</span>
                    <span>ROI: {rec.roi}x</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {rec.accepted === null ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: rec.id, accepted: true })}>
                        <Check className="mr-1 h-4 w-4" /> Accepter
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => updateMutation.mutate({ id: rec.id, accepted: false })}>
                        <X className="mr-1 h-4 w-4" /> Rejeter
                      </Button>
                    </>
                  ) : (
                    <Badge variant={rec.accepted ? 'default' : 'secondary'}>
                      {rec.accepted ? 'Accepte' : 'Rejete'}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
