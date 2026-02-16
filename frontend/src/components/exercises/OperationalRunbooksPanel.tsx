import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardList, Plus } from 'lucide-react';
import { runbooksApi, type RunbookRecord, type RunbookStep } from '@/api/runbooks.api';
import { simulationsApi } from '@/api/simulations.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/common/LoadingState';

type SimulationOption = {
  id: string;
  name: string;
  scenarioType: string;
};

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR');
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'validated' || status === 'completed') return 'default';
  if (status === 'failed' || status === 'cancelled') return 'destructive';
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
        return {
          id,
          name:
            typeof record.name === 'string' && record.name.trim().length > 0
              ? record.name
              : `Simulation ${id.slice(0, 8)}`,
          scenarioType: typeof record.scenarioType === 'string' ? record.scenarioType : 'custom',
        };
      })
      .filter((entry): entry is SimulationOption => Boolean(entry));
  }

  if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).simulations)) {
    return normalizeSimulations((raw as Record<string, unknown>).simulations);
  }

  return [];
}

function normalizeRunbookSteps(runbook: RunbookRecord | null): RunbookStep[] {
  if (!runbook?.steps || !Array.isArray(runbook.steps)) return [];
  return runbook.steps;
}

export function OperationalRunbooksPanel() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRunbookId, setSelectedRunbookId] = useState('');
  const [form, setForm] = useState({
    simulationId: '',
    title: '',
    description: '',
  });

  const runbooksQuery = useQuery({
    queryKey: ['ops-runbooks'],
    queryFn: async () => (await runbooksApi.getAll()).data,
  });

  const simulationsQuery = useQuery({
    queryKey: ['ops-simulations'],
    queryFn: async () => normalizeSimulations((await simulationsApi.getAll()).data),
  });

  useEffect(() => {
    if (!selectedRunbookId && runbooksQuery.data && runbooksQuery.data.length > 0) {
      setSelectedRunbookId(runbooksQuery.data[0].id);
    }
  }, [runbooksQuery.data, selectedRunbookId]);

  const selectedRunbook = useMemo(
    () => runbooksQuery.data?.find((runbook) => runbook.id === selectedRunbookId) ?? null,
    [runbooksQuery.data, selectedRunbookId],
  );

  const steps = normalizeRunbookSteps(selectedRunbook);

  const generateMutation = useMutation({
    mutationFn: () =>
      runbooksApi.generate({
        simulationId: form.simulationId,
        title: form.title || undefined,
        description: form.description || undefined,
      }),
    onSuccess: async () => {
      toast.success('Runbook genere depuis la simulation');
      setDialogOpen(false);
      setForm({ simulationId: '', title: '', description: '' });
      await queryClient.invalidateQueries({ queryKey: ['ops-runbooks'] });
    },
    onError: () => toast.error('Impossible de generer le runbook'),
  });

  const validateMutation = useMutation({
    mutationFn: (runbookId: string) => runbooksApi.validate(runbookId, { testResult: 'passed' }),
    onSuccess: async () => {
      toast.success('Runbook valide');
      await queryClient.invalidateQueries({ queryKey: ['ops-runbooks'] });
    },
    onError: () => toast.error('Validation du runbook echouee'),
  });

  if (runbooksQuery.isLoading) {
    return <LoadingState message="Chargement des runbooks..." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Generez des runbooks depuis les simulations et validez leur execution.
        </p>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Generer depuis une simulation
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px,1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Runbooks ({runbooksQuery.data?.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(runbooksQuery.data ?? []).map((runbook) => (
              <button
                type="button"
                key={runbook.id}
                onClick={() => setSelectedRunbookId(runbook.id)}
                className={`w-full rounded-md border p-3 text-left transition-colors ${
                  selectedRunbookId === runbook.id ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{runbook.title}</p>
                  <Badge variant={statusBadgeVariant(runbook.status)}>{runbook.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(runbook.generatedAt)}</p>
              </button>
            ))}
            {(runbooksQuery.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun runbook genere pour le moment.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" />
              {selectedRunbook?.title ?? 'Selectionnez un runbook'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedRunbook ? (
              <p className="text-sm text-muted-foreground">Selectionnez un runbook pour voir le detail.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusBadgeVariant(selectedRunbook.status)}>{selectedRunbook.status}</Badge>
                  <span className="text-xs text-muted-foreground">Genere: {formatDate(selectedRunbook.generatedAt)}</span>
                  {selectedRunbook.status !== 'validated' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => validateMutation.mutate(selectedRunbook.id)}
                      disabled={validateMutation.isPending}
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Valider
                    </Button>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">{selectedRunbook.description || selectedRunbook.summary}</p>

                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded-md border p-2 text-sm">
                    <p className="font-medium">RACI</p>
                    <p>Responsible: {selectedRunbook.responsible || '-'}</p>
                    <p>Accountable: {selectedRunbook.accountable || '-'}</p>
                    <p>Consulted: {selectedRunbook.consulted || '-'}</p>
                    <p>Informed: {selectedRunbook.informed || '-'}</p>
                  </div>
                  <div className="rounded-md border p-2 text-sm">
                    <p className="font-medium">Etat de test</p>
                    <p>Resultat: {selectedRunbook.testResult || 'non teste'}</p>
                    <p>Dernier test: {formatDate(selectedRunbook.lastTestedAt)}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="font-medium">Etapes</p>
                  {steps.length === 0 && (
                    <p className="text-sm text-muted-foreground">Ce runbook ne contient pas encore d'etapes structurees.</p>
                  )}
                  {steps.map((step) => (
                    <div key={`${selectedRunbook.id}-${step.order}`} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{step.order}. {step.title}</p>
                        <Badge variant="outline">{step.type}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Role: {step.assignedRole} | Duree estimee: {step.estimatedDurationMinutes} min
                      </p>
                      {(step.commands ?? []).length > 0 && (
                        <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
{(step.commands ?? []).join('\n')}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generer un runbook depuis une simulation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Simulation</Label>
              <select
                value={form.simulationId}
                onChange={(event) => setForm((prev) => ({ ...prev, simulationId: event.target.value }))}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Selectionner...</option>
                {(simulationsQuery.data ?? []).map((simulation) => (
                  <option key={simulation.id} value={simulation.id}>
                    {simulation.name} ({simulation.scenarioType})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Titre (optionnel)</Label>
              <Input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Description (optionnel)</Label>
              <Input value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !form.simulationId}>
              {generateMutation.isPending ? 'Generation...' : 'Generer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

