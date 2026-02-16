import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
  remediationApi,
  type RemediationPriority,
  type RemediationStatus,
  type RemediationTask,
} from '@/api/remediation.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { LoadingState } from '@/components/common/LoadingState';

const COLUMNS: Array<{ key: RemediationStatus; label: string }> = [
  { key: 'todo', label: 'Todo' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
  { key: 'blocked', label: 'Blocked' },
];

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
  return date.toLocaleString('fr-FR');
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'critical') return 'destructive';
  if (status === 'high') return 'secondary';
  if (status === 'low') return 'outline';
  return 'default';
}

export function RemediationKanbanPanel() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    title: '',
    recommendationId: '',
    priority: 'medium' as RemediationPriority,
    assignee: '',
    dueDate: '',
    estimatedCost: '',
  });

  const tasksQuery = useQuery({
    queryKey: ['ops-remediation'],
    queryFn: async () => (await remediationApi.getAll()).data,
  });

  const summaryQuery = useQuery({
    queryKey: ['ops-remediation-summary'],
    queryFn: async () => (await remediationApi.getSummary()).data,
  });

  const createTaskMutation = useMutation({
    mutationFn: () =>
      remediationApi.create({
        title: form.title,
        recommendationId: form.recommendationId,
        priority: form.priority,
        assignee: form.assignee || undefined,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        estimatedCost: form.estimatedCost ? Number(form.estimatedCost) : undefined,
      }),
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
        queryClient.invalidateQueries({ queryKey: ['ops-remediation'] }),
        queryClient.invalidateQueries({ queryKey: ['ops-remediation-summary'] }),
      ]);
    },
    onError: () => toast.error('Creation de tache echouee'),
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RemediationStatus }) =>
      remediationApi.update(id, {
        status,
        ...(status === 'done' ? { completedAt: new Date().toISOString() } : {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ops-remediation'] }),
        queryClient.invalidateQueries({ queryKey: ['ops-remediation-summary'] }),
      ]);
    },
  });

  const tasks = tasksQuery.data ?? [];
  const summary = summaryQuery.data;

  const tasksByStatus = useMemo(() => {
    const grouped: Record<RemediationStatus, RemediationTask[]> = {
      todo: [],
      in_progress: [],
      done: [],
      blocked: [],
      cancelled: [],
    };
    for (const task of tasks) {
      grouped[task.status].push(task);
    }
    return grouped;
  }, [tasks]);

  if (tasksQuery.isLoading || summaryQuery.isLoading) {
    return <LoadingState message="Chargement du suivi de remediation..." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Kanban de suivi des actions de remediation liees aux recommandations.</p>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nouvelle tache
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Progression globale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {summary?.doneCount ?? 0}/{summary?.total ?? 0} actions completees ({summary?.completionRate ?? 0}%)
          </p>
          <Progress value={summary?.completionRate ?? 0} />
          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
            <p>Cout estime total: {money(summary?.estimatedCostTotal)}</p>
            <p>Cout reel total: {money(summary?.actualCostTotal)}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-4">
        {COLUMNS.map((column) => (
          <Card key={column.key}>
            <CardHeader>
              <CardTitle className="text-sm">{column.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(tasksByStatus[column.key] ?? []).map((task) => (
                <div key={task.id} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center justify-between gap-1">
                    <p className="font-medium">{task.title}</p>
                    <Badge variant={statusBadgeVariant(task.priority)}>{task.priority}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Assignee: {task.assignee || '-'}</p>
                  <p className="text-xs text-muted-foreground">Cout estime: {money(task.estimatedCost)}</p>
                  <p className="text-xs text-muted-foreground">Due: {formatDate(task.dueDate)}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {task.status === 'todo' && (
                      <Button size="sm" variant="outline" onClick={() => updateTaskMutation.mutate({ id: task.id, status: 'in_progress' })}>
                        Start
                      </Button>
                    )}
                    {task.status === 'in_progress' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => updateTaskMutation.mutate({ id: task.id, status: 'done' })}>
                          Done
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => updateTaskMutation.mutate({ id: task.id, status: 'blocked' })}>
                          Block
                        </Button>
                      </>
                    )}
                    {task.status === 'blocked' && (
                      <Button size="sm" variant="outline" onClick={() => updateTaskMutation.mutate({ id: task.id, status: 'in_progress' })}>
                        Resume
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {(tasksByStatus[column.key] ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">Aucune tache</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle tache de remediation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Titre</Label>
              <Input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Recommendation ID</Label>
              <Input value={form.recommendationId} onChange={(event) => setForm((prev) => ({ ...prev, recommendationId: event.target.value }))} placeholder="rec-xxx" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Priorite</Label>
                <select
                  value={form.priority}
                  onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value as RemediationPriority }))}
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
                <Input value={form.assignee} onChange={(event) => setForm((prev) => ({ ...prev, assignee: event.target.value }))} />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Due date</Label>
                <Input type="datetime-local" value={form.dueDate} onChange={(event) => setForm((prev) => ({ ...prev, dueDate: event.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Cout estime (EUR)</Label>
                <Input type="number" min={0} value={form.estimatedCost} onChange={(event) => setForm((prev) => ({ ...prev, estimatedCost: event.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={() => createTaskMutation.mutate()} disabled={createTaskMutation.isPending || !form.title || !form.recommendationId}>
              {createTaskMutation.isPending ? 'Creation...' : 'Creer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

