import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Cloud, Pencil, Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { businessFlowsApi } from '@/api/businessFlows.api';
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

type CostMethod = 'direct' | 'annual' | 'transactional';

function formatMoney(value: number, currency: string = 'EUR') {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function BusinessFlowsPage() {
  const queryClient = useQueryClient();
  const tenantScope = getCredentialScopeKey();

  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('operations');
  const [method, setMethod] = useState<CostMethod>('direct');
  const [estimatedCostPerHour, setEstimatedCostPerHour] = useState('');
  const [annualRevenue, setAnnualRevenue] = useState('');
  const [transactionsPerHour, setTransactionsPerHour] = useState('');
  const [revenuePerTransaction, setRevenuePerTransaction] = useState('');

  const flowsQuery = useQuery({
    queryKey: ['business-flows', tenantScope],
    queryFn: async () => (await businessFlowsApi.list()).data,
  });

  const coverageQuery = useQuery({
    queryKey: ['flows-coverage', tenantScope],
    queryFn: async () => (await businessFlowsApi.getCoverage()).data,
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
      setAnnualRevenue('');
      setTransactionsPerHour('');
      setRevenuePerTransaction('');
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
      toast.success(`${result.data.suggestionsCreated} AI suggestion(s) created`);
      await refreshFlows();
    },
    onError: () => toast.error('AI suggestions unavailable'),
  });

  const enrichMutation = useMutation({
    mutationFn: () => businessFlowsApi.enrichFromCloud(),
    onSuccess: async (result) => {
      const data = result.data;
      toast.success(`${data.createdSuggestions} created, ${data.updatedSuggestions} updated`);
      await refreshFlows();
    },
    onError: () => toast.error('Cloud enrichment unavailable'),
  });

  const flows = flowsQuery.data || [];
  const coverage = coverageQuery.data;
  const lowCoverage = (coverage?.coveragePercent || 0) < 50;

  const sortedFlows = useMemo(
    () =>
      [...flows].sort(
        (a, b) =>
          (b.computedCost?.totalCostPerHour || b.calculatedCostPerHour || 0) -
          (a.computedCost?.totalCostPerHour || a.calculatedCostPerHour || 0),
      ),
    [flows],
  );

  const createFlow = () => {
    if (!name.trim()) return;
    const payload: Record<string, unknown> = {
      name: name.trim(),
      category,
      source: 'manual',
    };

    if (method === 'direct') {
      payload.estimatedCostPerHour = Number(estimatedCostPerHour || 0);
    } else if (method === 'annual') {
      payload.annualRevenue = Number(annualRevenue || 0);
      payload.operatingDaysPerWeek = 5;
      payload.operatingHoursPerDay = 10;
    } else {
      payload.transactionsPerHour = Number(transactionsPerHour || 0);
      payload.revenuePerTransaction = Number(revenuePerTransaction || 0);
    }

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

      <div className="space-y-3">
        {sortedFlows.map((flow) => {
          const total = flow.computedCost?.totalCostPerHour || flow.calculatedCostPerHour || 0;
          const peak = flow.computedCost?.peakCostPerHour || total * (flow.peakHoursMultiplier || 1);
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
                    {flow.flowNodes.length} node(s) • cost/h {formatMoney(total)} • peak {formatMoney(peak)}
                  </p>
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
            <DialogDescription>Fill at least one business value method.</DialogDescription>
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

            <div className="grid grid-cols-3 gap-2 rounded-md border p-2 text-sm">
              <button
                className={`rounded px-2 py-1 ${method === 'direct' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                type="button"
                onClick={() => setMethod('direct')}
              >
                Direct
              </button>
              <button
                className={`rounded px-2 py-1 ${method === 'annual' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                type="button"
                onClick={() => setMethod('annual')}
              >
                Annual
              </button>
              <button
                className={`rounded px-2 py-1 ${method === 'transactional' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                type="button"
                onClick={() => setMethod('transactional')}
              >
                Tx
              </button>
            </div>

            {method === 'direct' && (
              <Input
                type="number"
                min={1}
                value={estimatedCostPerHour}
                onChange={(event) => setEstimatedCostPerHour(event.target.value)}
                placeholder="Estimated cost / hour"
              />
            )}

            {method === 'annual' && (
              <Input
                type="number"
                min={1}
                value={annualRevenue}
                onChange={(event) => setAnnualRevenue(event.target.value)}
                placeholder="Annual revenue"
              />
            )}

            {method === 'transactional' && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={1}
                  value={transactionsPerHour}
                  onChange={(event) => setTransactionsPerHour(event.target.value)}
                  placeholder="Transactions/hour"
                />
                <Input
                  type="number"
                  min={1}
                  value={revenuePerTransaction}
                  onChange={(event) => setRevenuePerTransaction(event.target.value)}
                  placeholder="Revenue/transaction"
                />
              </div>
            )}
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
