import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, ClipboardList, FilePlus2, Search } from 'lucide-react';
import { ModuleErrorBoundary } from '@/components/ErrorBoundary';
import { runbooksApi } from '@/api/runbooks.api';
import { simulationsApi } from '@/api/simulations.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/common/LoadingState';
import { Skeleton } from '@/components/ui/skeleton';

type SimulationOption = {
  id: string;
  name: string;
  scenarioType: string;
};

const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  validated: 1,
  tested: 2,
  active: 3,
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

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR');
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === 'draft') {
    return <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700">draft</Badge>;
  }

  if (normalized === 'validated') {
    return <Badge className="bg-blue-500 text-white">validated</Badge>;
  }

  if (normalized === 'tested') {
    return <Badge className="bg-orange-500 text-white">tested</Badge>;
  }

  if (normalized === 'active') {
    return <Badge className="bg-emerald-600 text-white">active</Badge>;
  }

  return <Badge variant="secondary">{status}</Badge>;
}

function RunbooksPageInner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedSimulationId, setSelectedSimulationId] = useState('');
  const [search, setSearch] = useState('');

  const runbooksQuery = useQuery({
    queryKey: ['ops-runbooks'],
    queryFn: async () => (await runbooksApi.getAll()).data,
  });

  const simulationsQuery = useQuery({
    queryKey: ['ops-simulations'],
    queryFn: async () => normalizeSimulations((await simulationsApi.getAll()).data),
  });

  const simulationNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const simulation of simulationsQuery.data ?? []) {
      map.set(simulation.id, simulation.name);
    }
    return map;
  }, [simulationsQuery.data]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      return runbooksApi.generate({
        simulationId: selectedSimulationId,
      });
    },
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ['ops-runbooks'] });
      toast.success('Runbook genere depuis la simulation');
      navigate(`/simulations/runbooks/${response.data.runbook.id}`);
    },
    onError: () => {
      toast.error('Impossible de generer le runbook');
    },
  });

  const runbooks = useMemo(() => {
    const items = runbooksQuery.data ?? [];
    const searchValue = search.trim().toLowerCase();

    const filtered = searchValue.length === 0
      ? items
      : items.filter((runbook) => {
          const scenarioName = runbook.simulationId ? simulationNameById.get(runbook.simulationId) ?? '' : '';
          return (
            runbook.title.toLowerCase().includes(searchValue) ||
            runbook.status.toLowerCase().includes(searchValue) ||
            scenarioName.toLowerCase().includes(searchValue)
          );
        });

    return [...filtered].sort((left, right) => {
      const leftOrder = STATUS_ORDER[left.status.toLowerCase()] ?? 99;
      const rightOrder = STATUS_ORDER[right.status.toLowerCase()] ?? 99;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const leftDate = new Date(left.updatedAt).getTime();
      const rightDate = new Date(right.updatedAt).getTime();
      return rightDate - leftDate;
    });
  }, [runbooksQuery.data, search, simulationNameById]);

  if (runbooksQuery.isLoading || simulationsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <LoadingState variant="skeleton" count={6} />
      </div>
    );
  }

  const simulations = simulationsQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Runbooks operationnels</h1>
        <p className="text-sm text-muted-foreground">
          Generez vos runbooks depuis les simulations et appliquez le flux draft, validated, tested, active.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-3 lg:grid-cols-[1fr_320px_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher un runbook, un scenario, un statut..."
              />
            </div>

            <select
              value={selectedSimulationId}
              onChange={(event) => setSelectedSimulationId(event.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Selectionnez une simulation</option>
              {simulations.map((simulation) => (
                <option key={simulation.id} value={simulation.id}>
                  {simulation.name} ({simulation.scenarioType})
                </option>
              ))}
            </select>

            <Button
              onClick={() => generateMutation.mutate()}
              disabled={!selectedSimulationId || generateMutation.isPending}
              className="whitespace-nowrap"
            >
              <FilePlus2 className="mr-2 h-4 w-4" />
              {generateMutation.isPending ? 'Generation...' : 'Generer depuis une simulation'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {runbooks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <ClipboardList className="h-14 w-14 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">Aucun runbook</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Aucun runbook. Generez-en un depuis vos simulations.
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => {
                const firstSimulation = simulations[0];
                if (firstSimulation) {
                  setSelectedSimulationId(firstSimulation.id);
                }
              }}
            >
              Choisir une simulation
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Runbooks ({runbooks.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Titre</th>
                    <th className="pb-2 font-medium">Scenario lie</th>
                    <th className="pb-2 font-medium">Statut</th>
                    <th className="pb-2 font-medium">Responsible</th>
                    <th className="pb-2 font-medium">Derniere mise a jour</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {runbooks.map((runbook) => {
                    const scenarioName = runbook.simulationId
                      ? simulationNameById.get(runbook.simulationId) ?? runbook.simulationId
                      : '-';

                    return (
                      <tr key={runbook.id} className="hover:bg-accent/30">
                        <td className="py-3 font-medium">{runbook.title}</td>
                        <td className="py-3 text-muted-foreground">{scenarioName}</td>
                        <td className="py-3">{statusBadge(runbook.status)}</td>
                        <td className="py-3">{runbook.responsible || '-'}</td>
                        <td className="py-3 text-muted-foreground">{formatDate(runbook.updatedAt)}</td>
                        <td className="py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/simulations/runbooks/${runbook.id}`)}
                          >
                            Ouvrir
                            <ArrowRight className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function RunbooksPage() {
  return (
    <ModuleErrorBoundary moduleName="Runbooks">
      <RunbooksPageInner />
    </ModuleErrorBoundary>
  );
}
