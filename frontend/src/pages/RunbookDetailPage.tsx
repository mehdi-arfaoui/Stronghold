import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCheck,
  ClipboardCheck,
  Copy,
  GitBranch,
  Megaphone,
  Settings2,
  Wrench,
} from 'lucide-react';
import { ModuleErrorBoundary } from '@/components/ErrorBoundary';
import { runbooksApi, type RunbookContext, type RunbookStep } from '@/api/runbooks.api';
import { simulationsApi } from '@/api/simulations.api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type SimulationOption = {
  id: string;
  name: string;
};

type StepType = RunbookStep['type'];
type StepPhase = NonNullable<RunbookStep['phase']>;

type TransitionTarget = 'validated' | 'tested' | 'active';

const TYPE_META: Record<StepType, { label: string; Icon: typeof Wrench }> = {
  manual: { label: 'Manual', Icon: Wrench },
  automated: { label: 'Automated', Icon: Settings2 },
  decision: { label: 'Decision', Icon: GitBranch },
  notification: { label: 'Notification', Icon: Megaphone },
};

const PHASE_META: Record<StepPhase, { label: string; window: string }> = {
  detection: { label: 'Detection', window: '5-15 min' },
  containment: { label: 'Containment', window: '5-30 min' },
  recovery: { label: 'Recovery', window: 'Variable' },
  validation: { label: 'Validation', window: '15-30 min' },
  communication: { label: 'Communication', window: 'Cadencee' },
};

const PHASE_ORDER: StepPhase[] = ['detection', 'containment', 'recovery', 'validation', 'communication'];

const STATUS_META: Record<string, { className: string; label: string }> = {
  draft: {
    label: 'draft',
    className: 'border-slate-300 bg-slate-100 text-slate-700',
  },
  validated: {
    label: 'validated',
    className: 'bg-blue-500 text-white',
  },
  tested: {
    label: 'tested',
    className: 'bg-orange-500 text-white',
  },
  active: {
    label: 'active',
    className: 'bg-emerald-600 text-white',
  },
};

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
        };
      })
      .filter((entry): entry is SimulationOption => Boolean(entry));
  }

  if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).simulations)) {
    return normalizeSimulations((raw as Record<string, unknown>).simulations);
  }

  return [];
}

function inferPhase(step: RunbookStep): StepPhase {
  const raw = step.phase;
  if (raw && raw in PHASE_META) return raw;

  const title = step.title.toLowerCase();
  if (title.includes('detect') || title.includes('evaluat')) return 'detection';
  if (title.includes('contain')) return 'containment';
  if (title.includes('recover') || title.includes('restore') || title.includes('failover') || title.includes('bascul')) return 'recovery';
  if (title.includes('valid') || title.includes('verif')) return 'validation';
  return 'communication';
}

function normalizeRunbookSteps(steps?: RunbookStep[] | null): Array<RunbookStep & { phase: StepPhase; validationCriteria?: string; assignedRole: string }> {
  if (!Array.isArray(steps)) return [];
  return [...steps]
    .map((step, index) => ({
      ...step,
      id: step.id || `step-${index + 1}`,
      phase: inferPhase(step),
      validationCriteria: step.validationCriteria || step.verificationCheck,
      assignedRole: step.assignedRole || step.assignee || '-',
    }))
    .sort((left, right) => left.order - right.order);
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR');
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase();
  const meta = STATUS_META[normalized];
  if (!meta) {
    return <Badge variant="secondary">{status}</Badge>;
  }

  if (normalized === 'draft') {
    return (
      <Badge variant="outline" className={meta.className}>
        {meta.label}
      </Badge>
    );
  }

  return <Badge className={meta.className}>{meta.label}</Badge>;
}

function formatScenarioType(value?: string | null): string {
  if (!value) return '-';
  return value.replace(/[_-]+/g, ' ');
}

function nextTransition(status: string): { target: TransitionTarget; label: string } | null {
  const normalized = status.toLowerCase();

  if (normalized === 'draft') {
    return { target: 'validated', label: 'Valider' };
  }

  if (normalized === 'validated') {
    return { target: 'tested', label: 'Marquer comme teste' };
  }

  if (normalized === 'tested') {
    return { target: 'active', label: 'Activer' };
  }

  return null;
}

function RunbookDetailPageInner() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const runbookId = params.id ?? '';
  const queryClient = useQueryClient();

  const runbookQuery = useQuery({
    queryKey: ['ops-runbook', runbookId],
    enabled: Boolean(runbookId),
    queryFn: async () => (await runbooksApi.getById(runbookId)).data,
  });

  const simulationsQuery = useQuery({
    queryKey: ['ops-simulations'],
    queryFn: async () => normalizeSimulations((await simulationsApi.getAll()).data),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (target: TransitionTarget) => {
      if (!runbookId) {
        throw new Error('Runbook id is required');
      }

      if (target === 'validated') {
        return runbooksApi.validate(runbookId);
      }

      if (target === 'tested') {
        return runbooksApi.update(runbookId, {
          status: 'tested',
          lastTestedAt: new Date().toISOString(),
          testResult: 'passed',
        });
      }

      return runbooksApi.update(runbookId, {
        status: 'active',
      });
    },
    onSuccess: async (_, target) => {
      const statusLabel = target === 'validated' ? 'valide' : target === 'tested' ? 'teste' : 'active';
      toast.success(`Runbook ${statusLabel}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ops-runbook', runbookId] }),
        queryClient.invalidateQueries({ queryKey: ['ops-runbooks'] }),
      ]);
    },
    onError: () => {
      toast.error('Impossible de mettre a jour le statut du runbook');
    },
  });

  const runbook = runbookQuery.data;

  const steps = useMemo(() => normalizeRunbookSteps(runbook?.steps), [runbook?.steps]);
  const context: RunbookContext | null = runbook?.context ?? null;
  const stepById = useMemo(() => new Map(steps.map((step) => [step.id || `step-${step.order}`, step] as const)), [steps]);
  const stepsByPhase = useMemo(
    () =>
      PHASE_ORDER.map((phase) => ({
        phase,
        meta: PHASE_META[phase],
        steps: steps.filter((step) => step.phase === phase),
      })).filter((section) => section.steps.length > 0),
    [steps],
  );

  const simulationName = useMemo(() => {
    if (!runbook?.simulationId) return '-';
    const simulation = (simulationsQuery.data ?? []).find((entry) => entry.id === runbook.simulationId);
    return simulation?.name ?? runbook.simulationId;
  }, [runbook?.simulationId, simulationsQuery.data]);

  const transition = useMemo(
    () => (runbook ? nextTransition(runbook.status) : null),
    [runbook],
  );

  const raciRows = useMemo(
    () => [
      { label: 'Responsible', value: runbook?.responsible ?? '-' },
      { label: 'Accountable', value: runbook?.accountable ?? '-' },
      { label: 'Consulted', value: runbook?.consulted ?? '-' },
      { label: 'Informed', value: runbook?.informed ?? '-' },
    ],
    [runbook],
  );
  const impactedNodePreview = context?.impactedNodes?.slice(0, 6) ?? [];

  const copyCommands = async (commands: string[]) => {
    try {
      await navigator.clipboard.writeText(commands.join('\n'));
      toast.success('Commandes copiees');
    } catch {
      toast.error('Impossible de copier les commandes');
    }
  };

  if (runbookQuery.isLoading || simulationsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-44" />
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-52 w-full" />
        </div>
      </div>
    );
  }

  if (!runbook) {
    return (
      <Card>
        <CardContent className="space-y-4 py-10 text-center">
          <p className="text-lg font-semibold">Runbook introuvable</p>
          <p className="text-sm text-muted-foreground">
            Ce runbook n existe pas ou n est plus disponible.
          </p>
          <div>
            <Button variant="outline" onClick={() => navigate('/simulations/runbooks')}>
              Retour a la liste
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" onClick={() => navigate('/simulations/runbooks')} className="-ml-2">
            <ArrowLeft className="mr-1 h-4 w-4" /> Retour
          </Button>
          <h1 className="text-2xl font-bold">{runbook.title}</h1>
          <p className="text-sm text-muted-foreground">
            Scenario lie: {simulationName} | Type: {formatScenarioType(context?.scenarioType)} | Derniere mise a jour: {formatDate(runbook.updatedAt)}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {statusBadge(runbook.status)}
          {transition && (
            <Button
              onClick={() => updateStatusMutation.mutate(transition.target)}
              disabled={updateStatusMutation.isPending}
              size="sm"
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              {updateStatusMutation.isPending ? 'Mise a jour...' : transition.label}
            </Button>
          )}
          {!transition && (
            <p className="text-xs text-muted-foreground">Flux termine: runbook deja actif.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Runbook par phase</CardTitle>
          </CardHeader>
          <CardContent>
            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ce runbook ne contient pas encore d etapes structurees.
              </p>
            ) : (
              <div className="space-y-6">
                {stepsByPhase.map((section) => (
                  <div key={section.phase} className="space-y-4">
                    <div className="flex items-center justify-between gap-3 border-b pb-2">
                      <div>
                        <p className="font-semibold">{section.meta.label}</p>
                        <p className="text-xs text-muted-foreground">Fenetre cible: {section.meta.window}</p>
                      </div>
                      <Badge variant="outline">{section.steps.length} etape(s)</Badge>
                    </div>

                    <div className="space-y-5">
                      {section.steps.map((step, index) => {
                        const typeMeta = TYPE_META[step.type] ?? TYPE_META.manual;
                        const hasCommands = Array.isArray(step.commands) && step.commands.length > 0;
                        const prerequisiteLabels = (step.prerequisites ?? [])
                          .map((id) => stepById.get(id))
                          .filter(Boolean)
                          .map((entry) => `#${entry?.order}`);

                        return (
                          <div key={`${runbook.id}-${step.order}`} className="relative pl-10">
                            {index < section.steps.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%+12px)] w-px bg-border" />}
                            <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border bg-background text-xs font-semibold">
                              {step.order}
                            </span>

                            <div className="rounded-md border p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-medium">{step.title}</p>
                                <Badge variant="outline" className="inline-flex items-center gap-1">
                                  <typeMeta.Icon className="h-3.5 w-3.5" /> {typeMeta.label}
                                </Badge>
                              </div>

                              <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                              <p className="mt-2 text-xs text-muted-foreground">
                                Service: {step.serviceName || '-'} | Role: {step.assignedRole} | Duree estimee: {step.estimatedDurationMinutes} min
                              </p>

                              {prerequisiteLabels.length > 0 && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Prerequis: {prerequisiteLabels.join(', ')}
                                </p>
                              )}

                              {hasCommands && (
                                <div className="mt-3 overflow-hidden rounded-md border bg-slate-950">
                                  <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                                    <p className="text-xs text-slate-200">Commandes CLI</p>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      className="h-7 px-2"
                                      onClick={() => copyCommands(step.commands ?? [])}
                                    >
                                      <Copy className="mr-1 h-3.5 w-3.5" /> Copier
                                    </Button>
                                  </div>
                                  <pre className="overflow-x-auto p-3 text-xs text-slate-100">
                                    <code>{(step.commands ?? []).join('\n')}</code>
                                  </pre>
                                </div>
                              )}

                              {step.validationCriteria && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Validation: {step.validationCriteria}
                                </p>
                              )}

                              {step.rollbackInstructions && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Rollback: {step.rollbackInstructions}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contexte simulation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Type:</span> {formatScenarioType(context?.scenarioType)}
              </p>
              <p>
                <span className="text-muted-foreground">RTO predit:</span> {context?.predictedRTO ?? '-'} min
              </p>
              <p>
                <span className="text-muted-foreground">RPO predit:</span> {context?.predictedRPO ?? '-'} min
              </p>
              <p>
                <span className="text-muted-foreground">Noeuds impactes:</span> {context?.impactedNodes?.length ?? 0}
              </p>
              <p>
                <span className="text-muted-foreground">Evenements de propagation:</span> {context?.propagationTimeline?.length ?? 0}
              </p>
              {impactedNodePreview.length > 0 && (
                <div className="pt-1">
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Priorites de recovery</p>
                  <div className="flex flex-wrap gap-1.5">
                    {impactedNodePreview.map((node) => (
                      <Badge key={node.id} variant="secondary" className="text-[11px]">
                        {node.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">RACI</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <tbody>
                  {raciRows.map((row) => (
                    <tr key={row.label} className="border-b last:border-b-0">
                      <th className="w-28 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                        {row.label}
                      </th>
                      <td className="py-2 text-right text-sm">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Etat du runbook</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Genere le:</span> {formatDate(runbook.generatedAt)}
              </p>
              <p>
                <span className="text-muted-foreground">Dernier test:</span> {formatDate(runbook.lastTestedAt)}
              </p>
              <p>
                <span className="text-muted-foreground">Resultat test:</span> {runbook.testResult ?? '-'}
              </p>
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => navigate('/simulations/runbooks')}>
                <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Liste des runbooks
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function RunbookDetailPage() {
  return (
    <ModuleErrorBoundary moduleName="Runbook Detail">
      <RunbookDetailPageInner />
    </ModuleErrorBoundary>
  );
}

