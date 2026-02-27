import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Cloud, Pencil, Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { businessFlowsApi, type BusinessFlow } from '@/api/businessFlows.api';
import { financialApi } from '@/api/financial.api';
import { BusinessFlowDetailEditor } from '@/components/business-flows/BusinessFlowDetailEditor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import { invalidateFinancialProfileDependentQueries } from '@/lib/financialQueryInvalidation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type FlowFilter = 'all' | 'pending' | 'validated' | 'rejected';

function formatMoney(value: number, currency: string = 'EUR') {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function summarizeFlowServices(flow: BusinessFlow): string {
  const names = flow.flowNodes
    .slice(0, 4)
    .map((node) => node.infraNode?.name || node.infraNodeId)
    .filter(Boolean);
  if (names.length === 0) return 'Aucun service associe';
  const suffix = flow.flowNodes.length > names.length ? ` +${flow.flowNodes.length - names.length}` : '';
  return `${names.join(', ')}${suffix}`;
}

export function BusinessFlowsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const tenantScope = getCredentialScopeKey();

  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('operations');
  const [estimatedCostPerHour, setEstimatedCostPerHour] = useState('');
  const [activeFilter, setActiveFilter] = useState<FlowFilter>('all');
  const [rejectedFlows, setRejectedFlows] = useState<BusinessFlow[]>([]);

  const flowsQuery = useQuery({
    queryKey: ['business-flows', tenantScope],
    queryFn: async () => (await businessFlowsApi.list()).data,
  });

  const coverageQuery = useQuery({
    queryKey: ['flows-coverage', tenantScope],
    queryFn: async () => (await businessFlowsApi.getCoverage()).data,
  });

  const orgProfileQuery = useQuery({
    queryKey: ['financial-org-profile', tenantScope],
    queryFn: async () => (await financialApi.getOrgProfile()).data,
  });

  const refreshFlows = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['business-flows'] }),
      queryClient.invalidateQueries({ queryKey: ['flows-coverage'] }),
      invalidateFinancialProfileDependentQueries(queryClient),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => businessFlowsApi.create(payload),
    onSuccess: async () => {
      toast.success('Flux metier cree');
      setCreateOpen(false);
      setName('');
      setEstimatedCostPerHour('');
      await refreshFlows();
    },
    onError: () => toast.error('Creation impossible'),
  });

  const validateMutation = useMutation({
    mutationFn: (flowId: string) => businessFlowsApi.validate(flowId),
    onSuccess: async () => {
      toast.success('Flux valide');
      await refreshFlows();
    },
    onError: () => toast.error('Validation impossible'),
  });

  const rejectMutation = useMutation({
    mutationFn: (flow: BusinessFlow) => businessFlowsApi.remove(flow.id),
    onSuccess: async (_result, flow) => {
      setRejectedFlows((current) => [
        { ...flow, validatedByUser: false, validatedAt: null },
        ...current.filter((entry) => entry.id !== flow.id),
      ]);
      toast.success('Flux rejete');
      await refreshFlows();
    },
    onError: () => toast.error('Rejet impossible'),
  });

  const suggestMutation = useMutation({
    mutationFn: () => businessFlowsApi.suggestAI(),
    onSuccess: async (result) => {
      toast.success(`${result.data.suggestionsCreated} flux genere(s) par IA`);
      setActiveFilter('pending');
      await refreshFlows();
    },
    onError: () => toast.error('Suggestions IA indisponibles'),
  });

  const enrichMutation = useMutation({
    mutationFn: () => businessFlowsApi.enrichFromCloud(),
    onSuccess: async (result) => {
      const data = result.data;
      if (data.enrichedFlows === 0) {
        toast(data.message || 'Aucun flux enrichi automatiquement');
      } else {
        toast.success(
          `${data.enrichedFlows} flux enrichis, ${data.servicesAdded} services ajoutes, ${data.ignoredEmptyFlows} ignores`,
        );
      }
      await refreshFlows();
    },
    onError: () => toast.error('Enrichissement cloud indisponible'),
  });

  const flows = flowsQuery.data || [];
  const coverage = coverageQuery.data;
  const lowCoverage = (coverage?.coveragePercent || 0) < 50;
  const businessProfileConfigured = orgProfileQuery.data?.isConfigured === true;

  const sortedFlows = useMemo(
    () =>
      [...flows].sort((a, b) => {
        const leftDowntime = typeof a.downtimeCostPerHour === 'number' ? a.downtimeCostPerHour : -1;
        const rightDowntime = typeof b.downtimeCostPerHour === 'number' ? b.downtimeCostPerHour : -1;
        if (leftDowntime !== rightDowntime) {
          return rightDowntime - leftDowntime;
        }
        return (
          (b.computedCost?.totalCostPerHour || b.calculatedCostPerHour || 0) -
          (a.computedCost?.totalCostPerHour || a.calculatedCostPerHour || 0)
        );
      }),
    [flows],
  );

  const pendingFlows = useMemo(
    () => sortedFlows.filter((flow) => !flow.validatedByUser),
    [sortedFlows],
  );

  const validatedFlows = useMemo(
    () => sortedFlows.filter((flow) => flow.validatedByUser),
    [sortedFlows],
  );

  const visibleActiveFlows = useMemo(() => {
    if (activeFilter === 'pending') return pendingFlows;
    if (activeFilter === 'validated') return validatedFlows;
    return sortedFlows;
  }, [activeFilter, pendingFlows, sortedFlows, validatedFlows]);

  const createFlow = () => {
    if (!name.trim()) return;
    const parsedManualCost = Number(estimatedCostPerHour);

    const payload: Record<string, unknown> = {
      name: name.trim(),
      category,
      source: 'manual',
      estimatedCostPerHour: Number.isFinite(parsedManualCost) && parsedManualCost > 0 ? parsedManualCost : null,
      annualRevenue: null,
      transactionsPerHour: null,
      revenuePerTransaction: null,
    };

    createMutation.mutate(payload);
  };

  if (selectedFlowId) {
    return (
      <BusinessFlowDetailEditor
        flowId={selectedFlowId}
        onBack={() => setSelectedFlowId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Flux metier</h1>
          <p className="text-sm text-muted-foreground">
            Une seule interface pour valider, rejeter ou modifier les flux.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => suggestMutation.mutate()}
            disabled={suggestMutation.isPending}
          >
            <Bot className="mr-2 h-4 w-4" />
            Generer IA
          </Button>
          <Button
            variant="outline"
            onClick={() => enrichMutation.mutate()}
            disabled={enrichMutation.isPending}
          >
            <Cloud className="mr-2 h-4 w-4" />
            Enrichir cloud
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nouveau flux
          </Button>
        </div>
      </div>

      <Card className="border-muted/60">
        <CardHeader>
          <CardTitle className="text-base">Couverture financiere</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            {coverage
              ? `${coverage.coveredCriticalNodes}/${coverage.totalCriticalNodes} noeuds critiques couverts (${coverage.coveragePercent}%)`
              : 'Chargement de la couverture...'}
          </p>
          <Progress value={coverage?.coveragePercent || 0} className="h-2" />
          {lowCoverage && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Couverture inferieure a 50%: les estimations ROI restent partielles.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!businessProfileConfigured && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {orgProfileQuery.data?.inferenceBanner ||
                'Calculs bases sur les couts d infrastructure uniquement. Configurez votre profil financier pour l impact business.'}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-500 bg-amber-100 text-amber-900 hover:bg-amber-200"
              onClick={() => navigate('/settings?tab=finance')}
            >
              Configurer le profil financier
            </Button>
          </div>
        </div>
      )}

      <Card className="border-muted/60">
        <CardHeader>
          <CardTitle className="text-base">Flux</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={activeFilter === 'all' ? 'default' : 'outline'}
              onClick={() => setActiveFilter('all')}
            >
              Tous ({sortedFlows.length})
            </Button>
            <Button
              size="sm"
              variant={activeFilter === 'pending' ? 'default' : 'outline'}
              onClick={() => setActiveFilter('pending')}
            >
              A valider ({pendingFlows.length})
            </Button>
            <Button
              size="sm"
              variant={activeFilter === 'validated' ? 'default' : 'outline'}
              onClick={() => setActiveFilter('validated')}
            >
              Valides ({validatedFlows.length})
            </Button>
            <Button
              size="sm"
              variant={activeFilter === 'rejected' ? 'default' : 'outline'}
              onClick={() => setActiveFilter('rejected')}
            >
              Rejetes ({rejectedFlows.length})
            </Button>
          </div>

          <div className="space-y-3">
            {activeFilter === 'rejected' && rejectedFlows.map((flow) => (
              <Card key={`rejected-${flow.id}`} className="border-dashed border-muted">
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold">{flow.name}</h3>
                      <Badge variant="secondary">Rejete</Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setRejectedFlows((current) => current.filter((entry) => entry.id !== flow.id))
                      }
                    >
                      Retirer
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Flux rejete pendant cette session.
                  </p>
                </CardContent>
              </Card>
            ))}

            {activeFilter !== 'rejected' && visibleActiveFlows.map((flow) => {
              const flowCurrency = String(flow.currency || flow.computedCost?.currency || 'EUR').toUpperCase();
              const downtimeCostPerHour =
                typeof flow.downtimeCostPerHour === 'number' ? flow.downtimeCostPerHour : null;
              const isValidated = flow.validatedByUser;
              const servicesSummary = summarizeFlowServices(flow);

              return (
                <Card key={flow.id}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold">{flow.name}</h3>
                          <Badge variant={isValidated ? 'default' : 'outline'}>
                            {isValidated ? 'Valide' : 'A valider'}
                          </Badge>
                          {flow.source !== 'manual' && (
                            <Badge variant="secondary">{flow.source}</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Services: {servicesSummary}
                        </p>
                      </div>
                      <p className="text-sm font-medium">
                        Cout/h: {downtimeCostPerHour != null ? formatMoney(downtimeCostPerHour, flowCurrency) : '—'}
                      </p>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {flow.downtimeCostSourceLabel || flow.downtimeCostMessage || 'Cout indisponibilite non disponible'}
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {!isValidated && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => validateMutation.mutate(flow.id)}
                          disabled={validateMutation.isPending}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Valider
                        </Button>
                      )}
                      {!isValidated && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => rejectMutation.mutate(flow)}
                          disabled={rejectMutation.isPending}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Rejeter
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedFlowId(flow.id)}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Modifier
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {activeFilter === 'rejected' && rejectedFlows.length === 0 && (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Aucun flux rejete sur cette session.
                </CardContent>
              </Card>
            )}

            {activeFilter !== 'rejected' && visibleActiveFlows.length === 0 && (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Aucun flux dans ce filtre.
                </CardContent>
              </Card>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau flux metier</DialogTitle>
            <DialogDescription>
              Configurez un cout downtime/h manuel (optionnel).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex: Parcours de commande"
            />
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="revenue">Revenue</option>
              <option value="operations">Operations</option>
              <option value="compliance">Compliance</option>
              <option value="internal">Internal</option>
            </select>
            <Input
              type="number"
              min={0}
              value={estimatedCostPerHour}
              onChange={(event) => setEstimatedCostPerHour(event.target.value)}
              placeholder="Cout downtime/h (manuel)"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button onClick={createFlow} disabled={createMutation.isPending || !name.trim()}>
              Creer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
