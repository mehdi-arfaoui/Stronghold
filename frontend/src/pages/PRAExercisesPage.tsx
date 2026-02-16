import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Calendar,
  ClipboardCheck,
  Gauge,
  Plus,
  ShieldAlert,
} from 'lucide-react';
import { ModuleErrorBoundary } from '@/components/ErrorBoundary';
import {
  praExercisesApi,
  type PRAExerciseComparison,
  type PRAExerciseOutcome,
  type PRAExerciseStatus,
} from '@/api/pra-exercises.api';
import { runbooksApi, type RunbookRecord } from '@/api/runbooks.api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

type ScheduleFormState = {
  title: string;
  runbookId: string;
  scheduledAt: string;
  description: string;
  predictedRTO: string;
  predictedRPO: string;
};

type ResultFormState = {
  actualRTO: string;
  actualRPO: string;
  duration: string;
  outcome: PRAExerciseOutcome;
  findings: string;
};

function statusBadge(status: PRAExerciseStatus) {
  if (status === 'completed') {
    return <Badge className="bg-emerald-600 text-white">completed</Badge>;
  }

  if (status === 'in_progress') {
    return <Badge className="bg-blue-500 text-white">in_progress</Badge>;
  }

  if (status === 'cancelled') {
    return <Badge className="bg-red-600 text-white">cancelled</Badge>;
  }

  return (
    <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700">
      planned
    </Badge>
  );
}

function outcomeBadge(outcome?: PRAExerciseOutcome | null) {
  if (!outcome) return <Badge variant="outline">-</Badge>;

  if (outcome === 'success') {
    return <Badge className="bg-emerald-600 text-white">success</Badge>;
  }

  if (outcome === 'partial') {
    return <Badge className="bg-orange-500 text-white">partial</Badge>;
  }

  return <Badge className="bg-red-600 text-white">failure</Badge>;
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR');
}

function toNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return value;
}

function deltaMinutes(predicted: number | null, actual: number | null): number | null {
  if (predicted == null || actual == null) return null;
  return actual - predicted;
}

function deltaPercent(predicted: number | null, actual: number | null): number | null {
  if (predicted == null || actual == null) return null;
  if (predicted <= 0) return null;
  return ((actual - predicted) / predicted) * 100;
}

function formatSigned(value: number | null, suffix = ''): string {
  if (value == null) return '-';
  const rounded = Math.round(value * 10) / 10;
  const prefix = rounded > 0 ? '+' : '';
  return `${prefix}${rounded}${suffix}`;
}

function isSignificantDelta(predicted: number | null, actual: number | null): boolean {
  const percent = deltaPercent(predicted, actual);
  if (percent == null) return false;
  return Math.abs(percent) > 30;
}

function GaugeCard({
  label,
  predicted,
  actual,
}: {
  label: string;
  predicted: number | null;
  actual: number | null;
}) {
  const safePredicted = predicted ?? 0;
  const safeActual = actual ?? 0;
  const maxValue = Math.max(safePredicted, safeActual, 1);

  const predictedPercent = (safePredicted / maxValue) * 100;
  const actualPercent = (safeActual / maxValue) * 100;

  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  const predictedOffset = circumference - (predictedPercent / 100) * circumference;
  const isOverPrediction = safeActual > safePredicted;
  const actualColor = isOverPrediction ? '#dc2626' : '#0f766e';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-center">
          <div className="relative h-[130px] w-[130px]">
            <svg width="130" height="130" viewBox="0 0 130 130" className="-rotate-90">
              <circle cx="65" cy="65" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="10" />
              <circle
                cx="65"
                cy="65"
                r={radius}
                fill="none"
                stroke="#64748b"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={predictedOffset}
              />
              <circle
                cx="65"
                cy="65"
                r={radius - 8}
                fill="none"
                stroke={actualColor}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * (radius - 8)}
                strokeDashoffset={
                  2 * Math.PI * (radius - 8) - (actualPercent / 100) * 2 * Math.PI * (radius - 8)
                }
              />
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <p className="text-xl font-bold">{actual == null ? '-' : actual}</p>
              <p className="text-xs text-muted-foreground">min reel</p>
            </div>
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">Predit:</span> {predicted == null ? '-' : `${predicted} min`}
          </p>
          <p>
            <span className="text-muted-foreground">Reel:</span> {actual == null ? '-' : `${actual} min`}
          </p>
          <p>
            <span className="text-muted-foreground">Delta:</span>{' '}
            {formatSigned(deltaMinutes(predicted, actual), ' min')} ({formatSigned(deltaPercent(predicted, actual), '%')})
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function PRAExercisesPageInner() {
  const queryClient = useQueryClient();

  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);

  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>({
    title: '',
    runbookId: '',
    scheduledAt: '',
    description: '',
    predictedRTO: '',
    predictedRPO: '',
  });

  const [resultForm, setResultForm] = useState<ResultFormState>({
    actualRTO: '',
    actualRPO: '',
    duration: '',
    outcome: 'success',
    findings: '',
  });

  const exercisesQuery = useQuery({
    queryKey: ['ops-pra-exercises-list'],
    queryFn: async () => (await praExercisesApi.getAll()).data,
  });

  const runbooksQuery = useQuery({
    queryKey: ['ops-runbooks'],
    queryFn: async () => (await runbooksApi.getAll()).data,
  });

  const comparisonQuery = useQuery({
    queryKey: ['ops-pra-exercise-comparison', selectedExerciseId],
    enabled: Boolean(selectedExerciseId),
    queryFn: async () => (await praExercisesApi.getComparison(selectedExerciseId)).data,
  });

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      return praExercisesApi.create({
        title: scheduleForm.title,
        runbookId: scheduleForm.runbookId || undefined,
        scheduledAt: new Date(scheduleForm.scheduledAt).toISOString(),
        description: scheduleForm.description || undefined,
        predictedRTO: scheduleForm.predictedRTO ? Number(scheduleForm.predictedRTO) : undefined,
        predictedRPO: scheduleForm.predictedRPO ? Number(scheduleForm.predictedRPO) : undefined,
      });
    },
    onSuccess: async () => {
      toast.success('Exercice planifie');
      setScheduleOpen(false);
      setScheduleForm({
        title: '',
        runbookId: '',
        scheduledAt: '',
        description: '',
        predictedRTO: '',
        predictedRPO: '',
      });
      await queryClient.invalidateQueries({ queryKey: ['ops-pra-exercises-list'] });
    },
    onError: () => {
      toast.error('Impossible de planifier l exercice');
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (exerciseId: string) => {
      return praExercisesApi.update(exerciseId, {
        status: 'completed',
        executedAt: new Date().toISOString(),
        outcome: resultForm.outcome,
        duration: resultForm.duration ? Number(resultForm.duration) : undefined,
        actualRTO: resultForm.actualRTO ? Number(resultForm.actualRTO) : undefined,
        actualRPO: resultForm.actualRPO ? Number(resultForm.actualRPO) : undefined,
        findings: resultForm.findings ? { notes: resultForm.findings } : undefined,
      });
    },
    onSuccess: async () => {
      toast.success('Resultats enregistres');
      setResultsOpen(false);
      setResultForm({
        actualRTO: '',
        actualRPO: '',
        duration: '',
        outcome: 'success',
        findings: '',
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ops-pra-exercises-list'] }),
        queryClient.invalidateQueries({ queryKey: ['ops-pra-exercise-comparison', selectedExerciseId] }),
      ]);
    },
    onError: (error: unknown) => {
      const responseError =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;

      toast.error(responseError ?? 'Impossible de sauvegarder les resultats');
    },
  });

  const exercises = exercisesQuery.data ?? [];
  const runbooks = runbooksQuery.data ?? [];

  useEffect(() => {
    if (!selectedExerciseId && exercises.length > 0) {
      setSelectedExerciseId(exercises[0].id);
    }
  }, [selectedExerciseId, exercises]);

  const selectedExercise = useMemo(
    () => exercises.find((exercise) => exercise.id === selectedExerciseId) ?? null,
    [exercises, selectedExerciseId],
  );

  const runbookTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const runbook of runbooks) {
      map.set(runbook.id, runbook.title);
    }
    return map;
  }, [runbooks]);

  const comparison = comparisonQuery.data as PRAExerciseComparison | undefined;

  const predictedRTO = toNumber(comparison?.predicted.rto);
  const actualRTO = toNumber(comparison?.actual.rto);
  const predictedRPO = toNumber(comparison?.predicted.rpo);
  const actualRPO = toNumber(comparison?.actual.rpo);

  const showRecalibrationWarning =
    isSignificantDelta(predictedRTO, actualRTO) || isSignificantDelta(predictedRPO, actualRPO);

  const hasNoExercises = exercises.length === 0;

  if (exercisesQuery.isLoading || runbooksQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <Skeleton className="h-[420px] w-full" />
          <Skeleton className="h-[420px] w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Exercices PRA</h1>
          <p className="text-sm text-muted-foreground">
            Planifiez vos exercices et comparez les estimations Stronghold avec les resultats reels.
          </p>
        </div>
        <Button onClick={() => setScheduleOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Planifier un exercice
        </Button>
      </div>

      {hasNoExercises ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <Calendar className="h-14 w-14 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">Aucun exercice PRA</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Aucun exercice. Planifiez-en un a partir de vos runbooks.
            </p>
            <Button className="mt-4" onClick={() => setScheduleOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Planifier un exercice
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Calendrier et historique</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {exercises.map((exercise) => {
                const runbookLabel =
                  (exercise.runbookId && runbookTitleById.get(exercise.runbookId)) ||
                  exercise.runbook?.title ||
                  '-';

                return (
                  <button
                    key={exercise.id}
                    type="button"
                    onClick={() => setSelectedExerciseId(exercise.id)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      selectedExerciseId === exercise.id
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-accent/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{exercise.title}</p>
                      {statusBadge(exercise.status)}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Date planifiee: {formatDate(exercise.scheduledAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">Runbook: {runbookLabel}</p>
                    <div className="mt-1 text-xs">Outcome: {outcomeBadge(exercise.outcome)}</div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span className="inline-flex items-center gap-2">
                  <Gauge className="h-4 w-4" />
                  {selectedExercise ? selectedExercise.title : 'Comparatif predit vs reel'}
                </span>
                {selectedExercise && selectedExercise.status !== 'completed' && (
                  <Button size="sm" variant="outline" onClick={() => setResultsOpen(true)}>
                    <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Saisir les resultats
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedExercise ? (
                <p className="text-sm text-muted-foreground">
                  Selectionnez un exercice pour afficher sa comparaison.
                </p>
              ) : comparisonQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-40 w-full" />
                  <Skeleton className="h-40 w-full" />
                </div>
              ) : !comparison ? (
                <p className="text-sm text-muted-foreground">Aucune comparaison disponible pour cet exercice.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <GaugeCard label="RTO" predicted={predictedRTO} actual={actualRTO} />
                    <GaugeCard label="RPO" predicted={predictedRPO} actual={actualRPO} />
                  </div>

                  <div className="rounded-md border p-3 text-sm">
                    <p>
                      <span className="text-muted-foreground">Outcome:</span> {comparison.outcome ?? '-'}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Duree:</span>{' '}
                      {comparison.duration == null ? '-' : `${comparison.duration} min`}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Execute le:</span> {formatDate(comparison.executedAt)}
                    </p>
                    {comparison.findings && (
                      <p>
                        <span className="text-muted-foreground">Findings:</span>{' '}
                        {JSON.stringify(comparison.findings)}
                      </p>
                    )}
                  </div>

                  {showRecalibrationWarning && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                      <div className="flex items-center gap-2 font-medium">
                        <ShieldAlert className="h-4 w-4" />
                        Ecart significatif - envisagez de recalibrer les estimations BIA.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Planifier un exercice PRA</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Titre</Label>
              <Input
                value={scheduleForm.title}
                onChange={(event) =>
                  setScheduleForm((prev) => ({
                    ...prev,
                    title: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label>Runbook lie</Label>
              <select
                value={scheduleForm.runbookId}
                onChange={(event) =>
                  setScheduleForm((prev) => ({
                    ...prev,
                    runbookId: event.target.value,
                  }))
                }
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Selectionner...</option>
                {runbooks.map((runbook: RunbookRecord) => (
                  <option key={runbook.id} value={runbook.id}>
                    {runbook.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label>Date planifiee</Label>
              <Input
                type="datetime-local"
                value={scheduleForm.scheduledAt}
                onChange={(event) =>
                  setScheduleForm((prev) => ({
                    ...prev,
                    scheduledAt: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label>Description</Label>
              <textarea
                value={scheduleForm.description}
                onChange={(event) =>
                  setScheduleForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Objectif de l exercice, contexte, perimetre..."
                className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>RTO predit (min, optionnel)</Label>
                <Input
                  type="number"
                  min={0}
                  value={scheduleForm.predictedRTO}
                  onChange={(event) =>
                    setScheduleForm((prev) => ({
                      ...prev,
                      predictedRTO: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>RPO predit (min, optionnel)</Label>
                <Input
                  type="number"
                  min={0}
                  value={scheduleForm.predictedRPO}
                  onChange={(event) =>
                    setScheduleForm((prev) => ({
                      ...prev,
                      predictedRPO: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => scheduleMutation.mutate()}
              disabled={scheduleMutation.isPending || !scheduleForm.title || !scheduleForm.scheduledAt}
            >
              {scheduleMutation.isPending ? 'Planification...' : 'Planifier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resultsOpen} onOpenChange={setResultsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Saisir les resultats d exercice</DialogTitle>
          </DialogHeader>

          {!selectedExercise ? (
            <p className="text-sm text-muted-foreground">Aucun exercice selectionne.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Exercice: {selectedExercise.title}</p>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>RTO reel (min)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={resultForm.actualRTO}
                    onChange={(event) =>
                      setResultForm((prev) => ({
                        ...prev,
                        actualRTO: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="space-y-1">
                  <Label>RPO reel (min)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={resultForm.actualRPO}
                    onChange={(event) =>
                      setResultForm((prev) => ({
                        ...prev,
                        actualRPO: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Duree reelle (min)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={resultForm.duration}
                    onChange={(event) =>
                      setResultForm((prev) => ({
                        ...prev,
                        duration: event.target.value,
                      }))
                    }
                  />
                </div>

                <div className="space-y-1">
                  <Label>Outcome</Label>
                  <select
                    value={resultForm.outcome}
                    onChange={(event) =>
                      setResultForm((prev) => ({
                        ...prev,
                        outcome: event.target.value as PRAExerciseOutcome,
                      }))
                    }
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="success">success</option>
                    <option value="partial">partial</option>
                    <option value="failure">failure</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label>Findings</Label>
                <textarea
                  value={resultForm.findings}
                  onChange={(event) =>
                    setResultForm((prev) => ({
                      ...prev,
                      findings: event.target.value,
                    }))
                  }
                  placeholder="Observations, ecarts, points a corriger..."
                  className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setResultsOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => selectedExercise && completeMutation.mutate(selectedExercise.id)}
              disabled={completeMutation.isPending || !selectedExercise}
            >
              {completeMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PRAExercisesPage() {
  return (
    <ModuleErrorBoundary moduleName="Exercices PRA">
      <PRAExercisesPageInner />
    </ModuleErrorBoundary>
  );
}

