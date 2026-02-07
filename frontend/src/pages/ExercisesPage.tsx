import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Plus, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';
import { exercisesApi } from '@/api/exercises.api';

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planifie',
  in_progress: 'En cours',
  completed: 'Termine',
  cancelled: 'Annule',
};

export function ExercisesPage() {
  const query = useQuery({
    queryKey: ['exercises'],
    queryFn: async () => (await exercisesApi.getAll()).data,
  });

  if (query.isLoading) return <LoadingState message="Chargement des exercices..." />;

  const exercises = query.data ?? [];

  if (exercises.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Aucun exercice"
        description="Planifiez des exercices PRA/PCA pour tester vos procedures de reprise."
        actionLabel="Planifier un exercice"
        onAction={() => {}}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Exercices PRA/PCA</h2>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Planifier un exercice
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {exercises.map((ex) => (
          <Card key={ex.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{ex.name}</span>
                <Badge variant={ex.status === 'completed' ? 'default' : 'secondary'}>
                  {STATUS_LABELS[ex.status] || ex.status}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>{new Date(ex.scheduledDate).toLocaleDateString('fr-FR')}</span>
                </div>
                <p className="text-muted-foreground">Type: {ex.type}</p>
                <p className="text-muted-foreground">{ex.participants.length} participant(s)</p>
                {ex.results && (
                  <div className="mt-2 rounded-md bg-muted p-2">
                    <p className="text-xs font-semibold">Resultats</p>
                    <p className="text-xs">Score: {ex.results.score}/100</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
