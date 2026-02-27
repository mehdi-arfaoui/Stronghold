import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Cloud, Pencil, Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { businessFlowsApi, type FlowSuggestionResponse } from '@/api/businessFlows.api';
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

function formatMoney(value: number, currency: string = 'EUR') {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value || 0);
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
  const [latestSuggestionInsights, setLatestSuggestionInsights] = useState<
    FlowSuggestionResponse['suggestionInsights']
  >([]);

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
      toast.success('Business flow created');
      setCreateOpen(false);
      setName('');
      setEstimatedCostPerHour('');
      await refreshFlows();
    },
    onError: () => toast.error('Unable to create business flow'),
  });

  const validateMutation = useMutation({
    mutationFn: (flowId: string) => businessFlowsApi.validate(flowId),
    onSuccess: async () => {
      toast.success('Flow validated');
      await refreshFlows();
    },
    onError: () => toast.error('Validation failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (flowId: string) => businessFlowsApi.remove(flowId),
    onSuccess: async () => {
      toast.success('Flow deleted');
      await refreshFlows();
    },
    onError: () => toast.error('Deletion failed'),
  });

  const suggestMutation = useMutation({
    mutationFn: () => businessFlowsApi.suggestAI(),
    onSuccess: async (result) => {
      setLatestSuggestionInsights(result.data.suggestionInsights ?? []);
      toast.success(
        `${result.data.suggestionsCreated} suggestion(s) generee(s), ${result.data.suggestionInsights?.length || 0} exploitable(s)`,
      );
      await refreshFlows();
    },
    onError: () => toast.error('AI suggestions unavailable'),
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
    onError: () => toast.error('Cloud enrichment unavailable'),
  });

  const flows = flowsQuery.data || [];
  const coverage = coverageQuery.data;
  const lowCoverage = (coverage?.coveragePercent || 0) < 50;
  const businessProfileConfigured = orgProfileQuery.data?.isConfigured === true;

  const sortedFlows = useMemo(
    () =>
      [...flows].sort(
        (a, b) => {
          const leftDowntime =
            typeof a.downtimeCostPerHour === 'number' ? a.downtimeCostPerHour : -1;
          const rightDowntime =
            typeof b.downtimeCostPerHour === 'number' ? b.downtimeCostPerHour : -1;
          if (leftDowntime !== rightDowntime) {
            return rightDowntime - leftDowntime;
          }
          return (
            (b.computedCost?.totalCostPerHour || b.calculatedCostPerHour || 0) -
            (a.computedCost?.totalCostPerHour || a.calculatedCostPerHour || 0)
          );
        },
      ),
    [flows],
  );

  const createFlow = () => {
    if (!name.trim()) return;
    const parsedManualCost = Number(estimatedCostPerHour);

    const payload: Record<string, unknown> = {
      name: name.trim(),
      category,
      source: 'manual',
      estimatedCostPerHour:
        Number.isFinite(parsedManualCost) && parsedManualCost > 0
          ? parsedManualCost
          : null,
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
          <h1 className="text-2xl font-bold">Business Flows</h1>
          <p className="text-sm text-muted-foreground">
            Link technical nodes to business processes to improve financial accuracy.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => suggestMutation.mutate()}
            disabled={suggestMutation.isPending}
          >
            <Bot className="mr-2 h-4 w-4" />
            AI suggestions
          </Button>
          <Button
            variant="outline"
            onClick={() => enrichMutation.mutate()}
            disabled={enrichMutation.isPending}
          >
            <Cloud className="mr-2 h-4 w-4" />
            Cloud enrich
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New flow
          </Button>
        </div>
      </div>

      <Card className="border-muted/60">
        <CardHeader>
          <CardTitle className="text-base">Financial coverage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            {coverage
              ? `${coverage.coveredCriticalNodes}/${coverage.totalCriticalNodes} critical nodes covered (${coverage.coveragePercent}%)`
              : 'Loading coverage...'}
          </p>
          <Progress value={coverage?.coveragePercent || 0} className="h-2" />
          {lowCoverage && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Coverage under 50%: ROI estimates still rely heavily on fallback calculations.
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

      {latestSuggestionInsights.length > 0 && (
        <Card className="border-muted/60">
          <CardHeader>
            <CardTitle className="text-base">AI Suggestions (actionnables)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {latestSuggestionInsights.map((insight) => (
              <div key={insight.flowId} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{insight.label}</p>
                  <Badge variant="secondary">Suggestion</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{insight.proposedAction}</p>
                <p className="text-xs text-muted-foreground">{insight.rationale}</p>
                {insight.suggestedServicesToAdd.length > 0 && (
                  <p className="text-xs">
                    Services a ajouter: {insight.suggestedServicesToAdd.map((entry) => entry.nodeName).join(', ')}
                  </p>
                )}
                {insight.optimizationHints.length > 0 && (
                  <p className="text-xs">
                    Optimisations: {insight.optimizationHints.join(' | ')}
                  </p>
                )}
                {insight.spofAlerts.length > 0 && (
                  <p className="text-xs text-severity-critical">
                    Alertes SPOF: {insight.spofAlerts.join(' | ')}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => validateMutation.mutate(insight.flowId)}
                    disabled={validateMutation.isPending}
                  >
                    Appliquer
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deleteMutation.mutate(insight.flowId)}
                    disabled={deleteMutation.isPending}
                  >
                    Rejeter
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {sortedFlows.map((flow) => {
          const flowCurrency = String(flow.currency || flow.computedCost?.currency || 'EUR').toUpperCase();
          const downtimeCostPerHour =
            typeof flow.downtimeCostPerHour === 'number' ? flow.downtimeCostPerHour : null;
          const isValidated = flow.validatedByUser;
          return (
            <Card key={flow.id}>
              <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">{flow.name}</h3>
                    <Badge variant={isValidated ? 'default' : 'outline'}>
                      {isValidated ? 'Validated' : 'Not validated'}
                    </Badge>
                    {flow.source !== 'manual' && <Badge variant="secondary">{flow.source}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {flow.flowNodes.length} service(s) • cout/h indisponibilite{' '}
                    {downtimeCostPerHour != null
                      ? formatMoney(downtimeCostPerHour, flowCurrency)
                      : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {flow.downtimeCostSourceLabel || flow.downtimeCostMessage || '—'}
                  </p>
                  {flow.downtimeCostMessage && (
                    <p className="text-xs text-amber-700">{flow.downtimeCostMessage}</p>
                  )}
                  {Array.isArray(flow.contributingServices) && flow.contributingServices.length > 0 && (
                    <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                      <summary className="cursor-pointer font-medium">
                        Services contributeurs ({flow.contributingServices.length})
                      </summary>
                      <div className="mt-2 space-y-1">
                        {flow.contributingServices.map((service) => (
                          <div
                            key={`${flow.id}-${service.serviceId}`}
                            className="flex items-center justify-between gap-2"
                          >
                            <div className="flex items-center gap-2">
                              <span>{service.serviceName}</span>
                              {service.isMax && <Badge variant="secondary">MAX</Badge>}
                            </div>
                            <span>{formatMoney(service.downtimeCostPerHour, flowCurrency)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedFlowId(flow.id)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  {!isValidated && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => validateMutation.mutate(flow.id)}
                      disabled={validateMutation.isPending}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Validate
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deleteMutation.mutate(flow.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {sortedFlows.length === 0 && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No business flow yet. Create one manually, or start with AI/cloud suggestions.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New business flow</DialogTitle>
            <DialogDescription>
              Configurez un cout downtime/h manuel (optionnel).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex: Customer payment"
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
              Cancel
            </Button>
            <Button onClick={createFlow} disabled={createMutation.isPending || !name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
