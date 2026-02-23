import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, AlertTriangle, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { InfraGraph, type GraphViewMode } from '@/components/graph/InfraGraph';
import { GraphControls } from '@/components/graph/GraphControls';
import { GraphLegend } from '@/components/graph/GraphLegend';
import { NodeDetailPanel } from '@/components/graph/NodeDetailPanel';
import { ProgressBar } from '@/components/common/ProgressBar';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useGraph } from '@/hooks/useGraph';
import { useDiscovery } from '@/hooks/useDiscovery';
import { useGraphStore } from '@/stores/graph.store';
import { useDiscoveryStore } from '@/stores/discovery.store';
import { discoveryApi } from '@/api/discovery.api';
import { businessFlowsApi } from '@/api/businessFlows.api';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import { cn } from '@/lib/utils';
import type { InfraNode, InfraEdge } from '@/types/graph.types';
import type { ScanHealthProvider, ScanHealthIssue } from '@/types/discovery.types';

const FLOW_COLORS = [
  '#0ea5e9',
  '#f59e0b',
  '#10b981',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

function formatMoneyCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

export function DiscoveryPage() {
  const queryClient = useQueryClient();
  const tenantScope = getCredentialScopeKey();
  const [searchParams] = useSearchParams();
  const { nodes, edges, allNodes, allEdges, isLoading: graphLoading, availableTypes, availableProviders, availableRegions } = useGraph();
  const { layout, selectedNodeId, setSelectedNode } = useGraphStore();
  const { isScanning, currentJob } = useDiscoveryStore();
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [colorByBusinessFlow, setColorByBusinessFlow] = useState(false);
  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>('auto');
  const [showMiniMap, setShowMiniMap] = useState(false);
  const graphContainerRef = useRef<HTMLDivElement | null>(null);

  useDiscovery(scanJobId ?? undefined);

  const healthQuery = useQuery({
    queryKey: ['discovery-health'],
    queryFn: async () => (await discoveryApi.getHealth()).data.data,
    refetchInterval: 15000,
  });

  const flowsQuery = useQuery({
    queryKey: ['business-flows', tenantScope],
    queryFn: async () => (await businessFlowsApi.list()).data,
    staleTime: 60_000,
  });

  const selectedNode = allNodes.find((n) => n.id === selectedNodeId);
  const flows = flowsQuery.data || [];

  const flowColorById = useMemo(() => {
    const entries: Array<[string, string]> = flows.map((flow, index) => [
      flow.id,
      FLOW_COLORS[index % FLOW_COLORS.length] || FLOW_COLORS[0],
    ]);
    return new Map<string, string>(entries);
  }, [flows]);

  const nodeFlowMeta = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        flowId: string;
        flowName: string;
        color: string;
        contribution: number;
      }>
    >();

    for (const flow of flows) {
      const color = flowColorById.get(flow.id) || FLOW_COLORS[0];
      const flowCost = flow.computedCost?.totalCostPerHour || flow.calculatedCostPerHour || 0;
      for (const node of flow.flowNodes || []) {
        const multiplier = node.isCritical ? (node.hasAlternativePath ? 0.2 : 1) : 0.05;
        const contribution = flowCost * multiplier;
        const existing = map.get(node.infraNodeId) || [];
        existing.push({
          flowId: flow.id,
          flowName: flow.name,
          color,
          contribution,
        });
        map.set(node.infraNodeId, existing);
      }
    }

    return map;
  }, [flowColorById, flows]);

  const edgeColorById = useMemo(() => {
    const map = new Map<string, string>();
    const edgeLookup = new Map<string, string>(
      allEdges.map((edge): [string, string] => [`${edge.source}->${edge.target}`, edge.id]),
    );

    for (const flow of flows) {
      const color = flowColorById.get(flow.id) || FLOW_COLORS[0];
      const ordered = [...(flow.flowNodes || [])].sort((a, b) => a.orderIndex - b.orderIndex);
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const current = ordered[index];
        const next = ordered[index + 1];
        if (!current || !next) continue;
        const direct = edgeLookup.get(`${current.infraNodeId}->${next.infraNodeId}`);
        const reverse = edgeLookup.get(`${next.infraNodeId}->${current.infraNodeId}`);
        const edgeId = direct || reverse;
        if (edgeId && !map.has(edgeId)) {
          map.set(edgeId, color);
        }
      }
    }

    return map;
  }, [allEdges, flowColorById, flows]);

  const getNodeDataOverrides = useCallback(
    (node: InfraNode) => {
      if (!colorByBusinessFlow) return {};
      const linked = nodeFlowMeta.get(node.id) || [];
      if (linked.length === 0) {
        return {
          customBorderColor: '#9ca3af',
          showUnknownCostIndicator: true,
          flowTooltip: 'Aucun flux metier detecte sur ce noeud',
        };
      }

      const colors = Array.from(new Set(linked.map((item) => item.color)));
      const flowNames = linked.map((item) => item.flowName);
      const totalContribution = linked.reduce((sum, item) => sum + item.contribution, 0);

      return {
        customBorderColor: colors[0],
        flowStripeColors: colors,
        flowTooltip: `${flowNames.join(', ')} | cout/h ~ ${formatMoneyCompact(totalContribution)}`,
      };
    },
    [colorByBusinessFlow, nodeFlowMeta],
  );

  const getEdgeStyleOverrides = useCallback(
    (edge: InfraEdge) => {
      if (!colorByBusinessFlow) return {};
      const color = edgeColorById.get(edge.id);
      if (color) {
        return {
          animated: true,
          style: {
            stroke: color,
            strokeWidth: 2.5,
            opacity: 1,
          },
        };
      }
      return {
        style: {
          opacity: 0.18,
        },
      };
    },
    [colorByBusinessFlow, edgeColorById],
  );


  useEffect(() => {
    const focusIds = searchParams.get('focus')?.split(',').filter(Boolean) ?? [];
    if (focusIds.length > 0) {
      setSelectedNode(focusIds[0] ?? null);
    }
  }, [searchParams, setSelectedNode]);

  const launchScanMutation = useMutation({
    mutationFn: () => discoveryApi.launchScan({ providers: [] }),
    onSuccess: (res) => {
      setScanJobId(res.data.jobId);
      toast.success('Scan lance');
    },
    onError: () => toast.error('Erreur lors du lancement du scan'),
  });

  const confirmEdgeMutation = useMutation({
    mutationFn: (edgeId: string) => discoveryApi.confirmEdge(edgeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      toast.success('Dependance confirmee');
    },
  });

  const rejectEdgeMutation = useMutation({
    mutationFn: (edgeId: string) => discoveryApi.rejectEdge(edgeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      toast.success('Dependance rejetee');
    },
  });

  const handleNodeClick = useCallback((node: InfraNode) => {
    setSelectedNode(node.id);
  }, [setSelectedNode]);

  const [edgePopover, setEdgePopover] = useState<InfraEdge | null>(null);

  const handleEdgeClick = useCallback((edge: InfraEdge) => {
    if (edge.inferred) {
      setEdgePopover(edge);
    }
  }, []);

  const inferredCount = allEdges.filter((e) => e.inferred && !e.confirmed).length;

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullScreen(document.fullscreenElement === graphContainerRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    const target = graphContainerRef.current;
    if (!target) {
      return;
    }

    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch {
      toast.error('Impossible d\'activer le mode plein ecran');
    }
  }, []);

  if (graphLoading && !isScanning) {
    return <LoadingState message="Chargement du graphe..." />;
  }

  // Scanning phase
  if (isScanning && currentJob) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Scan en cours...
              ({currentJob.adapters.filter((a) => a.status === 'completed').length}/{currentJob.adapters.length} adapters)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentJob.adapters.map((adapter) => (
              <div key={adapter.adapter} className="flex items-center gap-3">
                {adapter.status === 'completed' ? (
                  <Check className="h-4 w-4 text-resilience-high" />
                ) : adapter.status === 'running' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : adapter.status === 'failed' ? (
                  <AlertTriangle className="h-4 w-4 text-severity-critical" />
                ) : (
                  <div className="h-4 w-4 rounded-full border-2" />
                )}
                <span className="flex-1 text-sm">
                  {adapter.provider} {adapter.region || ''}
                </span>
                <span className="text-sm text-muted-foreground">
                  {adapter.resourcesFound} ressources
                </span>
              </div>
            ))}
            <ProgressBar value={currentJob.progress} />
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>{currentJob.nodesFound} noeuds</span>
              <span>{currentJob.edgesFound} dependances</span>
              <span>{currentJob.inferredEdges} inferees</span>
            </div>
          </CardContent>
        </Card>

        {/* Show graph building up */}
        {allNodes.length > 0 && (
          <div className="h-[500px] rounded-lg border">
            <InfraGraph
              infraNodes={allNodes}
              infraEdges={allEdges}
              layout={layout}
              graphViewMode={graphViewMode}
              showMiniMap={showMiniMap}
            />
          </div>
        )}
      </div>
    );
  }

  // Empty state
  if (allNodes.length === 0) {
    return (
      <EmptyState
        title="Aucune infrastructure decouverte"
        description="Lancez un scan pour decouvrir automatiquement votre infrastructure."
        actionLabel="Lancer le scan"
        onAction={() => launchScanMutation.mutate()}
      />
    );
  }

  // Validation phase
  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">

      <Card>
        <CardHeader>
          <CardTitle>Sante du scan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {(healthQuery.data?.providers ?? []).map((provider: ScanHealthProvider) => (
              <div key={provider.name} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{provider.name}</span>
                  <Badge variant={provider.status === 'connected' ? 'default' : provider.status === 'partial' ? 'secondary' : 'destructive'}>
                    {provider.status}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Dernier scan: {provider.lastScanAt ? new Date(provider.lastScanAt).toLocaleString() : 'jamais'}
                </p>
                <p className="text-xs text-muted-foreground">Couverture: {provider.coveragePercentage ?? 0}%</p>
                {(provider.errors ?? []).slice(0, 2).map((err: ScanHealthIssue) => (
                  <p key={`${provider.name}-${err.code}-${err.message}`} className="mt-1 text-xs text-severity-critical">
                    {err.code}: {err.message}
                  </p>
                ))}
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            Coherence graphe - orphan: {healthQuery.data?.graphConsistency?.orphanNodes ?? 0}, reverse manquants: {healthQuery.data?.graphConsistency?.missingReverseEdges ?? 0}, stale: {healthQuery.data?.graphConsistency?.staleNodes ?? 0}
          </div>
        </CardContent>
      </Card>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[320px] flex-1">
          <GraphControls
            availableTypes={availableTypes}
            availableProviders={availableProviders}
            availableRegions={availableRegions}
          />
        </div>
        <Button
          variant={colorByBusinessFlow ? 'default' : 'outline'}
          onClick={() => setColorByBusinessFlow((value) => !value)}
        >
          Colorer par flux metier
        </Button>
        <Button
          variant={showMiniMap ? 'default' : 'outline'}
          onClick={() => setShowMiniMap((value) => !value)}
        >
          MiniMap
        </Button>
        <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1">
          {([
            { key: 'auto', label: 'Vue auto' },
            { key: 'grouped', label: 'Vue groupee' },
            { key: 'detailed', label: 'Vue detaillee' },
          ] as const).map((option) => (
            <Button
              key={option.key}
              size="sm"
              variant={graphViewMode === option.key ? 'default' : 'ghost'}
              className={cn(graphViewMode === option.key && 'pointer-events-none')}
              onClick={() => setGraphViewMode(option.key)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {graphViewMode === 'auto' && allNodes.length > 50 && (
          <Badge variant="secondary">Cluster auto actif ({allNodes.length} noeuds)</Badge>
        )}
      </div>

      {/* Main content */}
      <div
        ref={graphContainerRef}
        className="flex flex-1 gap-0 overflow-hidden rounded-lg border bg-background"
      >
        {/* Graph */}
        <div className="relative flex-1">
          <div className="absolute right-4 top-4 z-20">
            <Button variant="outline" size="sm" onClick={handleToggleFullscreen}>
              {isFullScreen ? (
                <>
                  <Minimize2 className="mr-2 h-4 w-4" />
                  Quitter le plein ecran
                </>
              ) : (
                <>
                  <Maximize2 className="mr-2 h-4 w-4" />
                  Mode Plein Ecran
                </>
              )}
            </Button>
          </div>

          <InfraGraph
            infraNodes={nodes}
            infraEdges={edges}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            layout={layout}
            getNodeDataOverrides={getNodeDataOverrides}
            getEdgeStyleOverrides={getEdgeStyleOverrides}
            graphViewMode={graphViewMode}
            showMiniMap={showMiniMap}
          />

          {/* Legend overlay */}
          <div className="absolute bottom-4 left-4">
            <GraphLegend />
          </div>

          {/* Edge confirmation popover */}
          {edgePopover && (
            <Popover open onOpenChange={() => setEdgePopover(null)}>
              <PopoverTrigger asChild>
                <span />
              </PopoverTrigger>
              <PopoverContent>
                <p className="mb-2 text-sm font-semibold">Dependance inferee</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  {edgePopover.source} &rarr; {edgePopover.target} ({edgePopover.type})
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => { confirmEdgeMutation.mutate(edgePopover.id); setEdgePopover(null); }}>
                    Confirmer
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { rejectEdgeMutation.mutate(edgePopover.id); setEdgePopover(null); }}>
                    Rejeter
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* Node detail panel */}
        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            edges={allEdges}
            allNodes={allNodes}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>

      {/* Stats bar */}
      <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
        <div className="flex gap-4 text-sm">
          <span>{allNodes.length} noeuds</span>
          <span>{allEdges.length} dependances</span>
          <span>{allNodes.filter((n) => n.isSPOF).length} SPOF</span>
          {inferredCount > 0 && (
            <Badge variant="secondary">{inferredCount} dependances inferees a valider</Badge>
          )}
        </div>
        <Button onClick={() => launchScanMutation.mutate()} disabled={launchScanMutation.isPending}>
          Relancer le scan
        </Button>
      </div>
    </div>
  );
}

