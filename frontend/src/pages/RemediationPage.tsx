import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, ClipboardList, Plus } from 'lucide-react';
import {
  remediationApi,
  type RemediationPriority,
  type RemediationStatus,
  type RemediationTask,
} from '@/api/remediation.api';
import { recommendationsApi, type Recommendation } from '@/api/recommendations.api';
import { ModuleErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

type RecommendationOption = {
  id: string;
  label: string;
};

type PriorityFilter = 'all' | RemediationPriority;

type RecommendationFilter = 'all' | string;

type TaskColumn = {
  key: RemediationStatus;
  label: string;
};

const COLUMNS: TaskColumn[] = [
  { key: 'todo', label: 'A faire' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'done', label: 'Termine' },
  { key: 'blocked', label: 'Bloque' },
];

const PRIORITY_CLASSNAMES: Record<RemediationPriority, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-blue-500 text-white',
  low: 'border-slate-300 bg-slate-100 text-slate-700',
};

function money(value?: number | null): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('fr-FR');
}

function normalizeRecommendations(raw: Recommendation[]): RecommendationOption[] {
  return (raw ?? []).map((recommendation) => {
    const label =
      recommendation.title?.trim() ||
      recommendation.serviceName?.trim() ||
      recommendation.action?.trim() ||
      `Recommendation ${recommendation.id.slice(0, 8)}`;

    return {
      id: recommendation.id,
      label,
    };
  });
}

function buildSummary(tasks: RemediationTask[]): {
  total: number;
  doneCount: number;
  completionRate: number;
  inProgressCount: number;
  flowProgressRate: number;
} {
  const total = tasks.length;
  const doneCount = tasks.filter((task) => task.status === 'done').length;
  const inProgressCount = tasks.filter((task) => task.status === 'in_progress').length;

  const completionRate = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  const flowProgressRate =
    total === 0 ? 0 : Math.round(((doneCount + inProgressCount * 0.5) / total) * 100);

  return {
    total,
    doneCount,
    completionRate,
    inProgressCount,
    flowProgressRate,
  };
}

function isOverdue(task: RemediationTask): boolean {
  if (!task.dueDate) return false;
  if (task.status === 'done' || task.status === 'cancelled') return false;
  const dueDate = new Date(task.dueDate);
  if (Number.isNaN(dueDate.getTime())) return false;
  return dueDate.getTime() < Date.now();
}

function RemediationPageInner() {
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<RemediationStatus | null>(null);

  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [recommendationFilter, setRecommendationFilter] = useState<RecommendationFilter>('all');

  const [form, setForm] = useState({
    title: '',
    recommendationId: '',
    priority: 'medium' as RemediationPriority,
    assignee: '',
    dueDate: '',
    estimatedCost: '',
  });

  const tasksQuery = useQuery({
    queryKey: ['ops-remediation-tasks'],
    queryFn: async () => (await remediationApi.getAll()).data,
  });

  const summaryQuery = useQuery({
    queryKey: ['ops-remediation-summary'],
    queryFn: async () => (await remediationApi.getSummary()).data,
  });

  const recommendationOptionsQuery = useQuery({
    queryKey: ['ops-remediation-recommendations'],
    queryFn: async () => normalizeRecommendations((await recommendationsApi.getAll()).data),
  });

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      return remediationApi.create({
        title: form.title,
        recommendationId: form.recommendationId,
        priority: form.priority,
        assignee: form.assignee || undefined,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        estimatedCost: form.estimatedCost ? Number(form.estimatedCost) : undefined,
      });
    },
    onSuccess: async () => {
      toast.success('Tache de remediation creee');
      setDialogOpen(false);
      setForm({
        title: '',
        recommendationId: '',
        priority: 'medium',
        assignee: '',
        dueDate: '',
        estimatedCost: '',
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ops-remediation-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['ops-remediation-summary'] }),
      ]);
    },
    onError: () => {
      toast.error('Impossible de creer la tache');
    },
  });

  const moveTaskMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: RemediationStatus }) => {
      const completedAt = status === 'done' ? new Date().toISOString() : null;
      return remediationApi.update(taskId, { status, completedAt });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ops-remediation-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['ops-remediation-summary'] }),
      ]);
    },
    onError: () => {
      toast.error('Impossible de deplacer la tache');
    },
  });

  const tasks = tasksQuery.data ?? [];
  const recommendationOptions = recommendationOptionsQuery.data ?? [];

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const priorityMatches = priorityFilter === 'all' || task.priority === priorityFilter;
      const recommendationMatches =
        recommendationFilter === 'all' || task.recommendationId === recommendationFilter;

      return priorityMatches && recommendationMatches;
    });
  }, [tasks, priorityFilter, recommendationFilter]);

  const groupedTasks = useMemo(() => {
    const groups: Record<RemediationStatus, RemediationTask[]> = {
      todo: [],
      in_progress: [],
      done: [],
      blocked: [],
      cancelled: [],
    };

    for (const task of filteredTasks) {
      groups[task.status].push(task);
    }

    for (const key of Object.keys(groups) as RemediationStatus[]) {
      groups[key].sort((left, right) => {
        const leftDate = new Date(left.updatedAt).getTime();
        const rightDate = new Date(right.updatedAt).getTime();
        return rightDate - leftDate;
      });
    }

    return groups;
  }, [filteredTasks]);

  const fallbackSummary = useMemo(() => buildSummary(tasks), [tasks]);

  const summary = summaryQuery.data
    ? {
        total: summaryQuery.data.total,
        doneCount: summaryQuery.data.doneCount,
        completionRate: Math.round(summaryQuery.data.completionRate),
        inProgressCount: summaryQuery.data.byStatus.in_progress ?? 0,
        flowProgressRate:
          summaryQuery.data.total === 0
            ? 0
            : Math.round(
                ((summaryQuery.data.doneCount + (summaryQuery.data.byStatus.in_progress ?? 0) * 0.5) /
                  summaryQuery.data.total) *
                  100,
              ),
      }
    : fallbackSummary;

  const cancelledCount = filteredTasks.filter((task) => task.status === 'cancelled').length;

  const recommendationLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const recommendation of recommendationOptions) {
      map.set(recommendation.id, recommendation.label);
    }
    return map;
  }, [recommendationOptions]);

  const handleDrop = (status: RemediationStatus) => {
    if (!draggedTaskId) return;

    const task = tasks.find((entry) => entry.id === draggedTaskId);
    if (!task || task.status === status) {
      setDraggedTaskId(null);
      setDropColumn(null);
      return;
    }

    moveTaskMutation.mutate({
      taskId: task.id,
      status,
    });

    setDraggedTaskId(null);
    setDropColumn(null);
  };

  const hasNoTasks = tasks.length === 0;

  if (tasksQuery.isLoading || summaryQuery.isLoading || recommendationOptionsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-72 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Suivi remediation</h1>
          <p className="text-sm text-muted-foreground">
            Pilotez les actions de mitigation par priorite, cout et avancement.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nouvelle tache
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {summary.doneCount}/{summary.total} actions completees ({summary.completionRate}%)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="all">Priorite: toutes</option>
                <option value="critical">critical</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>

              <select
                value={recommendationFilter}
                onChange={(event) => setRecommendationFilter(event.target.value as RecommendationFilter)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="all">Recommendation: toutes</option>
                {recommendationOptions.map((recommendation) => (
                  <option key={recommendation.id} value={recommendation.id}>
                    {recommendation.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Progress value={summary.flowProgressRate} />
          {summary.inProgressCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Avancement incluant les actions en cours: {summary.flowProgressRate}%
            </p>
          )}
        </CardContent>
      </Card>

      {hasNoTasks ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <ClipboardList className="h-14 w-14 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">Aucune tache de remediation</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Creez votre premiere tache pour suivre vos actions critiques.
            </p>
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Nouvelle tache
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-4">
            {COLUMNS.map((column) => (
              <Card
                key={column.key}
                data-testid={`kanban-column-${column.key}`}
                className={dropColumn === column.key ? 'border-primary bg-primary/5' : undefined}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropColumn(column.key);
                }}
                onDragLeave={() => {
                  if (dropColumn === column.key) {
                    setDropColumn(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop(column.key);
                }}
              >
                <CardHeader>
                  <CardTitle className="text-sm">
                    {column.label} ({groupedTasks[column.key].length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {groupedTasks[column.key].length === 0 && (
                    <p className="text-xs text-muted-foreground">Aucune tache dans cette colonne.</p>
                  )}

                  {groupedTasks[column.key].map((task) => {
                    const overdue = isOverdue(task);
                    const recommendationLabel =
                      recommendationLabelById.get(task.recommendationId) ?? task.recommendationId;

                    return (
                      <div
                        key={task.id}
                        data-testid={`task-card-${task.id}`}
                        draggable
                        onDragStart={() => setDraggedTaskId(task.id)}
                        onDragEnd={() => {
                          setDraggedTaskId(null);
                          setDropColumn(null);
                        }}
                        className="cursor-grab rounded-md border bg-background p-3 active:cursor-grabbing"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{task.title}</p>
                          <Badge
                            variant={task.priority === 'low' ? 'outline' : 'secondary'}
                            className={PRIORITY_CLASSNAMES[task.priority]}
                          >
                            {task.priority}
                          </Badge>
                        </div>

                        <p className="mt-1 text-xs text-muted-foreground">Assignee: {task.assignee || '-'}</p>
                        <p className="text-xs text-muted-foreground">Recommendation: {recommendationLabel}</p>
                        <p className="text-xs text-muted-foreground">Cout estime: {money(task.estimatedCost)}</p>
                        <p className={overdue ? 'text-xs font-medium text-red-600' : 'text-xs text-muted-foreground'}>
                          Due date: {formatDate(task.dueDate)}
                        </p>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>

          {cancelledCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4" />
              {cancelledCount} tache(s) annulee(s) masquees dans cette vue.
            </div>
          )}

          {filteredTasks.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Aucun resultat avec les filtres selectionnes.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle tache de remediation</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Titre</Label>
              <Input
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label>Recommendation source</Label>
              <select
                value={form.recommendationId}
                onChange={(event) => setForm((prev) => ({ ...prev, recommendationId: event.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Selectionner...</option>
                {recommendationOptions.map((recommendation) => (
                  <option key={recommendation.id} value={recommendation.id}>
                    {recommendation.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Priorite</Label>
                <select
                  value={form.priority}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      priority: event.target.value as RemediationPriority,
                    }))
                  }
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="critical">critical</option>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label>Assignee</Label>
                <Input
                  value={form.assignee}
                  onChange={(event) => setForm((prev) => ({ ...prev, assignee: event.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Date limite</Label>
                <Input
                  type="datetime-local"
                  value={form.dueDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <Label>Cout estime (EUR)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.estimatedCost}
                  onChange={(event) => setForm((prev) => ({ ...prev, estimatedCost: event.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => createTaskMutation.mutate()}
              disabled={createTaskMutation.isPending || !form.title || !form.recommendationId}
            >
              {createTaskMutation.isPending ? 'Creation...' : 'Creer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RemediationPage() {
  return (
    <ModuleErrorBoundary moduleName="Suivi Remediation">
      <RemediationPageInner />
    </ModuleErrorBoundary>
  );
}
