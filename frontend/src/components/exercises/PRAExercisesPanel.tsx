import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, Calendar, ClipboardCheck, Loader2, Plus, ShieldAlert } from 'lucide-react';
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
import { praExercisesApi, type PRAExerciseComparison } from '@/api/pra-exercises.api';
import { runbooksApi } from '@/api/runbooks.api';
import { simulationsApi } from '@/api/simulations.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/common/LoadingState';

type SimulationOption = { id: string; name: string };
type RunbookOption = { id: string; title: string };

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR');
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default';
  if (status === 'cancelled') return 'destructive';
  if (status === 'in_progress') return 'secondary';
  return 'outline';
}

function normalizeSimulations(raw: unknown): SimulationOption[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        if (!id) return null;
        const fallback = `Simulation ${id.slice(0, 8)}`;
        const name = typeof record.name === 'string' && record.name.trim().length > 0 ? record.name : fallback;
        return { id, name };
      })
      .filter((entry): entry is SimulationOption => Boolean(entry));
  }

  if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).simulations)) {
    return normalizeSimulations((raw as Record<string, unknown>).simulations);
  }

  return [];
}

export function PRAExercisesPanel() {
  const queryClient = useQueryClient();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState('');

  const [createForm, setCreateForm] = useState({
    title: '',
    scheduledAt: '',
    simulationId: '',
    runbookId: '',
    description: '',
  });

  const [resultForm, setResultForm] = useState({
    actualRTO: '',
    actualRPO: '',
    duration: '',
    outcome: 'success',
  });

  const exercisesQuery = useQuery({
    queryKey: ['ops-pra-exercises'],
    queryFn: async () => (await praExercisesApi.getAll()).data,
  });

  const runbooksQuery = useQuery({
    queryKey: ['ops-runbook-options'],
    queryFn: async () =>
      ((await runbooksApi.getAll()).data ?? []).map((runbook) => ({
        id: runbook.id,
        title: runbook.title,
      })) as RunbookOption[],
  });

  const simulationsQuery = useQuery({
    queryKey: ['ops-simulation-options'],
    queryFn: async () => normalizeSimulations((await simulationsApi.getAll()).data),
  });

  const comparisonQuery = useQuery({
    queryKey: ['ops-pra-comparison', selectedExerciseId],
    enabled: !!selectedExerciseId,
    queryFn: async () => (await praExercisesApi.getComparison(selectedExerciseId)).data,
  });

  useEffect(() => {
    if (!selectedExerciseId && exercisesQuery.data && exercisesQuery.data.length > 0) {
      setSelectedExerciseId(exercisesQuery.data[0].id);
    }
  }, [exercisesQuery.data, selectedExerciseId]);

  const selectedExercise = useMemo(
    () => exercisesQuery.data?.find((exercise) => exercise.id === selectedExerciseId) ?? null,
    [exercisesQuery.data, selectedExerciseId],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      praExercisesApi.create({
        title: createForm.title,
        scheduledAt: new Date(createForm.scheduledAt).toISOString(),
        simulationId: createForm.simulationId || undefined,
        runbookId: createForm.runbookId || undefined,
        description: createForm.description || undefined,
      }),
    onSuccess: async () => {
      toast.success('Exercice planifie');
      setCreateDialogOpen(false);
      setCreateForm({
        title: '',
        scheduledAt: '',
        simulationId: '',
        runbookId: '',
        description: '',
      });
      await queryClient.invalidateQueries({ queryKey: ['ops-pra-exercises'] });
    },
    onError: () => toast.error('Planification echouee'),
  });

  const updateResultsMutation = useMutation({
    mutationFn: (exerciseId: string) =>
      praExercisesApi.update(exerciseId, {
        status: 'completed',
        outcome: resultForm.outcome,
        duration: resultForm.duration ? Number(resultForm.duration) : undefined,
        actualRTO: resultForm.actualRTO ? Number(resultForm.actualRTO) : undefined,
        actualRPO: resultForm.actualRPO ? Number(resultForm.actualRPO) : undefined,
        executedAt: new Date().toISOString(),
      }),
    onSuccess: async () => {
      toast.success('Resultats exercice enregistres');
      setResultDialogOpen(false);
      setResultForm({
        actualRTO: '',
        actualRPO: '',
        duration: '',
        outcome: 'success',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ops-pra-exercises'] }),
        queryClient.invalidateQueries({ queryKey: ['ops-pra-comparison', selectedExerciseId] }),
      ]);
    },
    onError: () => toast.error('Mise a jour des resultats echouee'),
  });

  const comparison = comparisonQuery.data as PRAExerciseComparison | undefined;
  const chartData = comparison
    ? [
        { metric: 'RTO', Predicted: comparison.predicted.rto ?? 0, Actual: comparison.actual.rto ?? 0 },
        { metric: 'RPO', Predicted: comparison.predicted.rpo ?? 0, Actual: comparison.actual.rpo ?? 0 },
      ]
    : [];

  const needsRecalibration =
    comparison != null &&
    (Math.abs(comparison.deviation.rto ?? 0) > 30 || Math.abs(comparison.deviation.rpo ?? 0) > 30);

  if (exercisesQuery.isLoading || runbooksQuery.isLoading || simulationsQuery.isLoading) {
    return <LoadingState message="Chargement des exercices PRA..." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Planifiez les exercices et comparez RTO/RPO predits vs mesures.</p>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Planifier un exercice
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px,1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4" /> Calendrier / Historique
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(exercisesQuery.data ?? []).map((exercise) => (
              <button
                type="button"
                key={exercise.id}
                onClick={() => setSelectedExerciseId(exercise.id)}
                className={`w-full rounded-md border p-3 text-left ${
                  selectedExerciseId === exercise.id ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="font-medium">{exercise.title}</p>
                  <Badge variant={statusBadgeVariant(exercise.status)}>{exercise.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Planifie: {formatDate(exercise.scheduledAt)}</p>
                {exercise.executedAt && (
                  <p className="text-xs text-muted-foreground">Execute: {formatDate(exercise.executedAt)}</p>
                )}
              </button>
            ))}
            {(exercisesQuery.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun exercice PRA planifie.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span className="inline-flex items-center gap-2">
                <Activity className="h-4 w-4" />
                {selectedExercise?.title ?? 'Comparaison predit vs reel'}
              </span>
              {selectedExercise && selectedExercise.status !== 'completed' && (
                <Button size="sm" variant="outline" onClick={() => setResultDialogOpen(true)}>
                  <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Saisir resultats
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedExercise ? (
              <p className="text-sm text-muted-foreground">Selectionnez un exercice pour afficher la comparaison.</p>
            ) : comparisonQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement de la comparaison...
              </div>
            ) : !comparison ? (
              <p className="text-sm text-muted-foreground">Aucune comparaison disponible pour cet exercice.</p>
            ) : (
              <>
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-md border p-2 text-sm">
                    <p className="font-medium">RTO</p>
                    <p>Predit: {comparison.predicted.rto ?? '-'} min</p>
                    <p>Reel: {comparison.actual.rto ?? '-'} min</p>
                    <p>Delta: {comparison.deviation.rto ?? '-'} min</p>
                  </div>
                  <div className="rounded-md border p-2 text-sm">
                    <p className="font-medium">RPO</p>
                    <p>Predit: {comparison.predicted.rpo ?? '-'} min</p>
                    <p>Reel: {comparison.actual.rpo ?? '-'} min</p>
                    <p>Delta: {comparison.deviation.rpo ?? '-'} min</p>
                  </div>
                  <div className="rounded-md border p-2 text-sm">
                    <p className="font-medium">Outcome</p>
                    <p>{comparison.outcome || '-'}</p>
                    <p>Duree: {comparison.duration ?? '-'} min</p>
                    <p>Statut: {comparison.status}</p>
                  </div>
                </div>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="metric" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="Predicted" fill="#64748b" />
                      <Bar dataKey="Actual" fill="#0ea5e9" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {needsRecalibration && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    <div className="flex items-center gap-2 font-medium">
                      <ShieldAlert className="h-4 w-4" />
                      Ecart important detecte: recalibrer le BIA recommande
                    </div>
                    <p className="mt-1 text-xs">
                      Le RTO/RPO reel diverge fortement du predit. Relancez une revue BIA et mettez a jour les runbooks.
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Planifier un exercice PRA</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Titre</Label>
              <Input value={createForm.title} onChange={(event) => setCreateForm((prev) => ({ ...prev, title: event.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Date planifiee</Label>
              <Input type="datetime-local" value={createForm.scheduledAt} onChange={(event) => setCreateForm((prev) => ({ ...prev, scheduledAt: event.target.value }))} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Simulation (optionnel)</Label>
                <select
                  value={createForm.simulationId}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, simulationId: event.target.value }))}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Aucune</option>
                  {(simulationsQuery.data ?? []).map((simulation) => (
                    <option key={simulation.id} value={simulation.id}>{simulation.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Runbook (optionnel)</Label>
                <select
                  value={createForm.runbookId}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, runbookId: event.target.value }))}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Aucun</option>
                  {(runbooksQuery.data ?? []).map((runbook) => (
                    <option key={runbook.id} value={runbook.id}>{runbook.title}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description (optionnel)</Label>
              <Input value={createForm.description} onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDialogOpen(false)}>Annuler</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !createForm.title || !createForm.scheduledAt}>
              {createMutation.isPending ? 'Planification...' : 'Planifier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resultDialogOpen} onOpenChange={setResultDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renseigner les resultats d'exercice</DialogTitle>
          </DialogHeader>
          {!selectedExercise ? (
            <p className="text-sm text-muted-foreground">Aucun exercice selectionne.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Exercice: {selectedExercise.title}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Actual RTO (min)</Label>
                  <Input type="number" min={0} value={resultForm.actualRTO} onChange={(event) => setResultForm((prev) => ({ ...prev, actualRTO: event.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Actual RPO (min)</Label>
                  <Input type="number" min={0} value={resultForm.actualRPO} onChange={(event) => setResultForm((prev) => ({ ...prev, actualRPO: event.target.value }))} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Duree reelle (min)</Label>
                  <Input type="number" min={0} value={resultForm.duration} onChange={(event) => setResultForm((prev) => ({ ...prev, duration: event.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Outcome</Label>
                  <select
                    value={resultForm.outcome}
                    onChange={(event) => setResultForm((prev) => ({ ...prev, outcome: event.target.value }))}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="success">success</option>
                    <option value="partial">partial</option>
                    <option value="failure">failure</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResultDialogOpen(false)}>Annuler</Button>
            <Button onClick={() => selectedExercise && updateResultsMutation.mutate(selectedExercise.id)} disabled={updateResultsMutation.isPending || !selectedExercise}>
              {updateResultsMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

