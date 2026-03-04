import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Info, Loader2, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { businessFlowsApi, type BusinessFlow, type BusinessFlowNode } from '@/api/businessFlows.api';
import { discoveryApi } from '@/api/discovery.api';
import { ServiceIdentityLabel } from '@/components/common/ServiceIdentityLabel';
import { InfraGraph } from '@/components/graph/InfraGraph';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import { buildVisibleFlowNodeIds } from '@/lib/businessFlowGraph';
import { invalidateFinancialProfileDependentQueries } from '@/lib/financialQueryInvalidation';
import { resolveIdentityLabels } from '@/lib/serviceIdentity';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { InfraEdge, InfraNode } from '@/types/graph.types';

type FlowFormState = {
  name: string;
  description: string;
  category: string;
  estimatedCostPerHour: string;
  peakHoursMultiplier: string;
  peakHoursStart: string;
  peakHoursEnd: string;
  operatingDaysPerWeek: string;
  operatingHoursPerDay: string;
  slaUptimePercent: string;
  slaPenaltyPerHour: string;
  slaPenaltyFlat: string;
  contractualRTO: string;
  estimatedCustomerChurnPerHour: string;
  customerLifetimeValue: string;
};

const FLOW_COLOR = '#0ea5e9';
const ROLE_OPTIONS = [
  'entry_point',
  'processing',
  'data_store',
  'notification',
  'external_dependency',
] as const;

function toFieldValue(value: number | null | undefined): string {
  return Number.isFinite(value as number) ? String(value) : '';
}

function toNullableNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 0 ? parsed : null;
}

function toNullableInt(value: string, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.floor(parsed);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

function buildInitialFormState(flow: BusinessFlow): FlowFormState {
  return {
    name: flow.name || '',
    description: flow.description || '',
    category: flow.category || 'operations',
    estimatedCostPerHour: toFieldValue(flow.estimatedCostPerHour),
    peakHoursMultiplier: toFieldValue(flow.peakHoursMultiplier ?? 1.5),
    peakHoursStart: toFieldValue(flow.peakHoursStart),
    peakHoursEnd: toFieldValue(flow.peakHoursEnd),
    operatingDaysPerWeek: toFieldValue(flow.operatingDaysPerWeek ?? 5),
    operatingHoursPerDay: toFieldValue(flow.operatingHoursPerDay ?? 10),
    slaUptimePercent: toFieldValue(flow.slaUptimePercent),
    slaPenaltyPerHour: toFieldValue(flow.slaPenaltyPerHour),
    slaPenaltyFlat: toFieldValue(flow.slaPenaltyFlat),
    contractualRTO: toFieldValue(flow.contractualRTO),
    estimatedCustomerChurnPerHour: toFieldValue(flow.estimatedCustomerChurnPerHour),
    customerLifetimeValue: toFieldValue(flow.customerLifetimeValue),
  };
}

function computeCostPreview(form: FlowFormState) {
  const directEstimate = toNullableNumber(form.estimatedCostPerHour) || 0;
  const peakMultiplier = Math.max(1, Number(form.peakHoursMultiplier || 1.5));
  const slaPenalty = Math.max(0, Number(form.slaPenaltyPerHour || 0));
  const churnPerHour = Math.max(0, Number(form.estimatedCustomerChurnPerHour || 0));
  const ltv = Math.max(0, Number(form.customerLifetimeValue || 0));
  const directCostPerHour = directEstimate;

  const indirectCostPerHour = churnPerHour * ltv;
  const totalCostPerHour = directCostPerHour + slaPenalty + indirectCostPerHour;
  const peakCostPerHour = totalCostPerHour * peakMultiplier;

  return {
    directCostPerHour,
    slaPenaltyPerHour: slaPenalty,
    indirectCostPerHour,
    totalCostPerHour,
    peakCostPerHour,
  };
}

function formatMoney(value: number, currency: string = 'EUR') {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

type BusinessFlowDetailEditorProps = {
  flowId: string;
  onBack: () => void;
};

export function BusinessFlowDetailEditor({ flowId, onBack }: BusinessFlowDetailEditorProps) {
  const queryClient = useQueryClient();
  const tenantScope = getCredentialScopeKey();

  const flowQuery = useQuery({
    queryKey: ['business-flow', flowId, tenantScope],
    queryFn: async () => (await businessFlowsApi.getById(flowId)).data,
  });

  const graphQuery = useQuery({
    queryKey: ['graph-flow-editor', tenantScope],
    queryFn: async () => (await discoveryApi.getGraph()).data,
    staleTime: 60_000,
  });

  const [form, setForm] = useState<FlowFormState>({
    name: '',
    description: '',
    category: 'operations',
    estimatedCostPerHour: '',
    peakHoursMultiplier: '1.5',
    peakHoursStart: '',
    peakHoursEnd: '',
    operatingDaysPerWeek: '5',
    operatingHoursPerDay: '10',
    slaUptimePercent: '',
    slaPenaltyPerHour: '',
    slaPenaltyFlat: '',
    contractualRTO: '',
    estimatedCustomerChurnPerHour: '',
    customerLifetimeValue: '',
  });
  const [showFullGraph, setShowFullGraph] = useState(false);

  useEffect(() => {
    if (!flowQuery.data) return;
    setForm(buildInitialFormState(flowQuery.data));
  }, [flowQuery.data]);

  useEffect(() => {
    setShowFullGraph(false);
  }, [flowId]);

  const refreshFlow = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['business-flow', flowId] }),
      queryClient.invalidateQueries({ queryKey: ['business-flows'] }),
      queryClient.invalidateQueries({ queryKey: ['flows-coverage'] }),
      invalidateFinancialProfileDependentQueries(queryClient),
    ]);
  }, [flowId, queryClient]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category,
        operatingDaysPerWeek: toNullableInt(form.operatingDaysPerWeek, 1, 7),
        operatingHoursPerDay: toNullableInt(form.operatingHoursPerDay, 1, 24),
        peakHoursMultiplier: toNullableNumber(form.peakHoursMultiplier) || 1.5,
        peakHoursStart: toNullableInt(form.peakHoursStart, 0, 23),
        peakHoursEnd: toNullableInt(form.peakHoursEnd, 0, 23),
        slaUptimePercent: toNullableNumber(form.slaUptimePercent),
        slaPenaltyPerHour: toNullableNumber(form.slaPenaltyPerHour),
        slaPenaltyFlat: toNullableNumber(form.slaPenaltyFlat),
        contractualRTO: toNullableInt(form.contractualRTO, 0, 10080),
        estimatedCustomerChurnPerHour: toNullableNumber(form.estimatedCustomerChurnPerHour),
        customerLifetimeValue: toNullableNumber(form.customerLifetimeValue),
        estimatedCostPerHour: toNullableNumber(form.estimatedCostPerHour),
        annualRevenue: null,
        transactionsPerHour: null,
        revenuePerTransaction: null,
      };

      return businessFlowsApi.update(flowId, payload);
    },
    onSuccess: async () => {
      toast.success('Flow updated');
      await refreshFlow();
    },
    onError: () => toast.error('Unable to save flow'),
  });

  const validateMutation = useMutation({
    mutationFn: () => businessFlowsApi.validate(flowId),
    onSuccess: async () => {
      toast.success('Flow validated');
      await refreshFlow();
    },
    onError: () => toast.error('Validation failed'),
  });

  const upsertNodeMutation = useMutation({
    mutationFn: (nodePayload: {
      infraNodeId: string;
      orderIndex: number;
      role?: string;
      isCritical: boolean;
      hasAlternativePath: boolean;
      alternativeNodeId: string | null;
    }) =>
      businessFlowsApi.addNodes(flowId, {
        nodes: [nodePayload],
      }),
    onSuccess: async () => {
      await refreshFlow();
    },
  });

  const removeNodeMutation = useMutation({
    mutationFn: (nodeId: string) => businessFlowsApi.removeNode(flowId, nodeId),
    onSuccess: async () => {
      await refreshFlow();
    },
  });

  const flow = flowQuery.data;
  const graph = graphQuery.data;
  const currency = String(flow?.currency || flow?.computedCost?.currency || 'EUR').toUpperCase();
  const graphNodes = graph?.nodes || [];
  const graphEdges = graph?.edges || [];
  const flowNodesSorted = useMemo(
    () => [...(flow?.flowNodes || [])].sort((a, b) => a.orderIndex - b.orderIndex),
    [flow?.flowNodes],
  );

  const flowNodeById = useMemo(() => {
    const map = new Map<string, BusinessFlowNode>();
    flowNodesSorted.forEach((entry) => {
      map.set(entry.infraNodeId, entry);
    });
    return map;
  }, [flowNodesSorted]);

  const flowNodeIdSet = useMemo(
    () => new Set(flowNodesSorted.map((entry) => entry.infraNodeId)),
    [flowNodesSorted],
  );
  const visibleNodeIds = useMemo(
    () => buildVisibleFlowNodeIds(flowNodesSorted.map((entry) => entry.infraNodeId), graphEdges),
    [flowNodesSorted, graphEdges],
  );
  const graphFilterActive = flowNodesSorted.length > 0 && !showFullGraph;
  const flowDowntimeCostPerHour =
    typeof flow?.downtimeCostPerHour === 'number' && Number.isFinite(flow.downtimeCostPerHour)
      ? flow.downtimeCostPerHour
      : null;

  const pathEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    if (flowNodesSorted.length < 2) return ids;

    for (let index = 0; index < flowNodesSorted.length - 1; index += 1) {
      const current = flowNodesSorted[index];
      const next = flowNodesSorted[index + 1];
      if (!current || !next) continue;
      const edge = graphEdges.find(
        (candidate) =>
          (candidate.source === current.infraNodeId && candidate.target === next.infraNodeId) ||
          (candidate.target === current.infraNodeId && candidate.source === next.infraNodeId),
      );
      if (edge) ids.add(edge.id);
    }

    return ids;
  }, [flowNodesSorted, graphEdges]);

  const currentPreview = useMemo(() => computeCostPreview(form), [form]);

  const onToggleGraphNode = (node: InfraNode) => {
    const existing = flowNodeById.get(node.id);
    if (existing) {
      removeNodeMutation.mutate(node.id);
      return;
    }

    const nextOrderIndex =
      flowNodesSorted.length === 0
        ? 0
        : Math.max(...flowNodesSorted.map((item) => item.orderIndex)) + 1;

    upsertNodeMutation.mutate({
      infraNodeId: node.id,
      orderIndex: nextOrderIndex,
      role: flowNodesSorted.length === 0 ? 'entry_point' : 'processing',
      isCritical: true,
      hasAlternativePath: false,
      alternativeNodeId: null,
    });
  };

  const upsertFlowNodeMetadata = (
    nodeId: string,
    patch: Partial<{
      role: string | null;
      isCritical: boolean;
      hasAlternativePath: boolean;
      alternativeNodeId: string | null;
      orderIndex: number;
    }>,
  ) => {
    const current = flowNodeById.get(nodeId);
    if (!current) return;

    upsertNodeMutation.mutate({
      infraNodeId: nodeId,
      orderIndex: patch.orderIndex ?? current.orderIndex,
      role: patch.role ?? (current.role || undefined),
      isCritical: patch.isCritical ?? current.isCritical,
      hasAlternativePath: patch.hasAlternativePath ?? current.hasAlternativePath,
      alternativeNodeId: patch.alternativeNodeId ?? current.alternativeNodeId,
    });
  };

  const nodeOverrides = useCallback(
    (node: InfraNode) => {
      const linked = flowNodeById.get(node.id);
      if (linked) {
        const roleLabel = linked.role || 'processing';
        const identity = resolveIdentityLabels(linked.infraNode || node);
        const tooltip = [
          identity.primary,
          identity.secondary ? `tech: ${identity.secondary}` : null,
          `role: ${roleLabel}`,
          linked.isCritical ? 'critical: yes' : 'critical: no',
        ]
          .filter(Boolean)
          .join(' | ');

        return {
          customBorderColor: FLOW_COLOR,
          dimmed: false,
          flowStripeColors: [FLOW_COLOR],
          flowRole: roleLabel,
          flowTooltip: tooltip,
          customOpacity: 1,
          disablePointerEvents: false,
        };
      }

      if (graphFilterActive && visibleNodeIds.has(node.id)) {
        const identity = resolveIdentityLabels(node);
        return {
          customBorderColor: '#94a3b8',
          dimmed: false,
          flowTooltip: `${identity.primary}${identity.secondary ? ` (${identity.secondary})` : ''} | dependance directe du flux`,
          customOpacity: 1,
          disablePointerEvents: false,
        };
      }

      return {
        customBorderColor: graphFilterActive ? '#9ca3af' : undefined,
        dimmed: graphFilterActive,
        customOpacity: graphFilterActive ? 0.12 : 1,
        disablePointerEvents: graphFilterActive,
      };
    },
    [flowNodeById, graphFilterActive, visibleNodeIds],
  );

  const edgeOverrides = useCallback(
    (edge: InfraEdge) => {
      if (pathEdgeIds.has(edge.id)) {
        return {
          animated: true,
          style: {
            stroke: FLOW_COLOR,
            strokeWidth: 3,
            opacity: 1,
          },
        };
      }
      if (graphFilterActive) {
        const sourceVisible = visibleNodeIds.has(edge.source);
        const targetVisible = visibleNodeIds.has(edge.target);
        return {
          style: {
            opacity: sourceVisible && targetVisible ? 0.45 : 0.12,
            strokeWidth: sourceVisible && targetVisible ? 1.5 : 1,
          },
        };
      }
      if (flowNodeIdSet.has(edge.source) || flowNodeIdSet.has(edge.target)) {
        return {
          style: {
            strokeWidth: 1.5,
            opacity: 0.35,
          },
        };
      }
      return {};
    },
    [graphFilterActive, pathEdgeIds, flowNodeIdSet, visibleNodeIds],
  );

  if (flowQuery.isLoading || graphQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!flow || !graph) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8">
          <p className="text-sm text-muted-foreground">Unable to load the flow detail.</p>
          <Button variant="outline" onClick={onBack}>
            Back to flows
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h2 className="text-xl font-semibold">{flow.name}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => validateMutation.mutate()}
            disabled={validateMutation.isPending}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Validate
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Flow graph editor</CardTitle>
            <p className="text-sm text-muted-foreground">
              Click a node to add/remove it from the flow. Active path is highlighted.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {flowNodesSorted.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                <Badge variant={graphFilterActive ? 'default' : 'outline'}>
                  {graphFilterActive ? `Affichage filtre : ${flow.name} - ${flowNodesSorted.length} services` : 'Vue complete du graphe'}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFullGraph((current) => !current)}
                >
                  {graphFilterActive ? 'Voir tout' : 'Revenir au filtre'}
                </Button>
              </div>
            )}

            <div className="h-[540px] rounded-lg border">
              <InfraGraph
                infraNodes={graphNodes}
                infraEdges={graphEdges}
                onNodeClick={onToggleGraphNode}
                getNodeDataOverrides={nodeOverrides}
                getEdgeStyleOverrides={edgeOverrides}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Flow nodes</p>
              {flowNodesSorted.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No node linked yet. Click nodes in the graph to build the flow.
                </p>
              )}
              {flowNodesSorted.map((entry) => {
                const identity = resolveIdentityLabels(entry.infraNode || { id: entry.infraNodeId });
                return (
                <div
                  key={entry.id}
                  className="grid gap-2 rounded-md border p-2 md:grid-cols-[1.8fr_1fr_0.8fr_0.8fr_auto]"
                >
                  <div>
                    <ServiceIdentityLabel
                      primary={identity.primary}
                      secondary={identity.secondary}
                      className="text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Order: {entry.orderIndex}
                    </p>
                  </div>
                  <select
                    value={entry.role || 'processing'}
                    onChange={(event) =>
                      upsertFlowNodeMetadata(entry.infraNodeId, {
                        role: event.target.value,
                      })
                    }
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={entry.isCritical}
                      onChange={(event) =>
                        upsertFlowNodeMetadata(entry.infraNodeId, {
                          isCritical: event.target.checked,
                        })
                      }
                    />
                    Critical
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={entry.hasAlternativePath}
                      onChange={(event) =>
                        upsertFlowNodeMetadata(entry.infraNodeId, {
                          hasAlternativePath: event.target.checked,
                        })
                      }
                    />
                    Alt path
                  </label>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => removeNodeMutation.mutate(entry.infraNodeId)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Business value</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-muted/25 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Cout/h calcule du flux</p>
                  <p className="text-lg font-semibold">
                    {flowNodesSorted.length === 0
                      ? 'Cout non calculable - associez des services'
                      : flowDowntimeCostPerHour != null
                        ? `${formatMoney(flowDowntimeCostPerHour, currency)}/h`
                        : flow.downtimeCostMessage || 'Cout non calculable'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {flow.downtimeCostSourceLabel || flow.downtimeCostMessage || 'Somme ponderee des couts de services'}
                  </p>
                </div>
                {flow.contributingServices && flow.contributingServices.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="rounded-full border p-2 text-muted-foreground transition-colors hover:bg-accent/40"
                        aria-label="Voir la decomposition du cout"
                      >
                        <Info className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent align="end" className="max-w-sm space-y-1">
                      <p className="text-xs font-semibold">
                        Cout/h total : {formatMoney(flowDowntimeCostPerHour ?? 0, currency)}/h
                      </p>
                      {flow.contributingServices.map((service) => {
                        const identity = resolveIdentityLabels(service);
                        return (
                          <div key={`${flow.id}-${service.serviceId}`} className="text-xs">
                            {identity.primary}
                            {identity.secondary ? ` (${identity.secondary})` : ''}:{' '}
                            {formatMoney(service.weightedContribution, currency)}/h
                            {' '}(
                            poids: {service.impactWeight.toFixed(1)},
                            base {formatMoney(service.downtimeCostPerHour, currency)}/h)
                          </div>
                        );
                      })}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            <Input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Flow name"
            />
            <textarea
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Description"
              className="min-h-[70px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            <select
              value={form.category}
              onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="revenue">revenue</option>
              <option value="operations">operations</option>
              <option value="compliance">compliance</option>
              <option value="internal">internal</option>
            </select>
            <Input
              type="number"
              min={0}
              value={form.estimatedCostPerHour}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, estimatedCostPerHour: event.target.value }))
              }
              placeholder="Cout downtime/h (manuel)"
            />

            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">Peak hours</p>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  type="number"
                  min={1}
                  step="0.1"
                  value={form.peakHoursMultiplier}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, peakHoursMultiplier: event.target.value }))
                  }
                  placeholder="Multiplier"
                />
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={form.peakHoursStart}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, peakHoursStart: event.target.value }))
                  }
                  placeholder="Start"
                />
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={form.peakHoursEnd}
                  onChange={(event) => setForm((prev) => ({ ...prev, peakHoursEnd: event.target.value }))}
                  placeholder="End"
                />
              </div>
            </div>

            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">SLA and penalties</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.slaUptimePercent}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, slaUptimePercent: event.target.value }))
                  }
                  placeholder="Uptime %"
                />
                <Input
                  type="number"
                  min={0}
                  value={form.slaPenaltyPerHour}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, slaPenaltyPerHour: event.target.value }))
                  }
                  placeholder="Penalty /h"
                />
                <Input
                  type="number"
                  min={0}
                  value={form.slaPenaltyFlat}
                  onChange={(event) => setForm((prev) => ({ ...prev, slaPenaltyFlat: event.target.value }))}
                  placeholder="Penalty flat"
                />
                <Input
                  type="number"
                  min={0}
                  value={form.contractualRTO}
                  onChange={(event) => setForm((prev) => ({ ...prev, contractualRTO: event.target.value }))}
                  placeholder="Contractual RTO (min)"
                />
              </div>
            </div>

            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">Indirect impact</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min={0}
                  value={form.estimatedCustomerChurnPerHour}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      estimatedCustomerChurnPerHour: event.target.value,
                    }))
                  }
                  placeholder="Lost customers/hour"
                />
                <Input
                  type="number"
                  min={0}
                  value={form.customerLifetimeValue}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, customerLifetimeValue: event.target.value }))
                  }
                  placeholder="Customer LTV"
                />
              </div>
            </div>

            <div className="rounded-md border bg-muted/25 p-3 text-sm">
              <p className="font-medium">Apercu manuel</p>
              <p>Direct: {formatMoney(currentPreview.directCostPerHour, currency)}</p>
              <p>SLA: {formatMoney(currentPreview.slaPenaltyPerHour, currency)}</p>
              <p>Indirect: {formatMoney(currentPreview.indirectCostPerHour, currency)}</p>
              <p className="font-semibold">Total: {formatMoney(currentPreview.totalCostPerHour, currency)}</p>
              <p className="font-semibold">Total peak: {formatMoney(currentPreview.peakCostPerHour, currency)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>
    </TooltipProvider>
  );
}
