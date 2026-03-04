import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Info,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { InfraGraph } from '@/components/graph/InfraGraph';
import { GraphControls } from '@/components/graph/GraphControls';
import { GraphLegend } from '@/components/graph/GraphLegend';
import { NodeDetailPanel } from '@/components/graph/NodeDetailPanel';
import { ProgressBar } from '@/components/common/ProgressBar';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FinancialOnboardingWizard } from '@/components/financial/FinancialOnboardingWizard';
import { useGraph } from '@/hooks/useGraph';
import { useDiscovery } from '@/hooks/useDiscovery';
import { useResilienceScore } from '@/hooks/useResilienceScore';
import { useGraphStore } from '@/stores/graph.store';
import { useDiscoveryStore } from '@/stores/discovery.store';
import { discoveryApi } from '@/api/discovery.api';
import { businessFlowsApi } from '@/api/businessFlows.api';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import {
  buildCloudProviderScanPayload,
  loadCloudProviderConfigs,
} from '@/lib/cloudProviderConfigs';
import { formatRelativeTime } from '@/lib/formatters';
import { filterServiceNodes } from '@/lib/graph-visuals';
import { cn } from '@/lib/utils';
import type { InfraNode, InfraEdge } from '@/types/graph.types';
import type { ScanHealthProvider, ScanHealthIssue, ScanHealthReport } from '@/types/discovery.types';

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

const DISCOVERY_OVERLAY_SURFACE =
  'rounded-xl border bg-background/90 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/75';

function getProviderStatusDotClass(status: ScanHealthProvider['status']): string {
  switch (status) {
    case 'connected':
      return 'bg-emerald-500';
    case 'partial':
      return 'bg-amber-500';
    case 'error':
      return 'bg-rose-500';
    default:
      return 'bg-slate-400';
  }
}

function getProviderStatusBadge(status: ScanHealthProvider['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'connected':
      return 'default';
    case 'partial':
      return 'secondary';
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

function getProviderStatusLabel(status: ScanHealthProvider['status']): string {
  switch (status) {
    case 'connected':
      return 'connecté';
    case 'partial':
      return 'partiel';
    case 'error':
      return 'erreur';
    default:
      return 'non configuré';
  }
}

function getLatestScanAt(providers: ScanHealthProvider[]): string | null {
  const timestamps = providers
    .map((provider) => provider.lastScanAt)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function ProviderHealthChip({ provider }: { provider: ScanHealthProvider }) {
  const coverageLabel =
    provider.status === 'not_configured' ? '--' : `${Math.round(provider.coveragePercentage ?? 0)}%`;

  return (
    <div className="inline-flex h-8 items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 text-xs font-medium text-foreground/90">
      <span className={cn('h-2.5 w-2.5 rounded-full', getProviderStatusDotClass(provider.status))} />
      <Cloud className="h-3.5 w-3.5 text-muted-foreground" />
      <span>{provider.name}</span>
      <span className="text-muted-foreground">{coverageLabel}</span>
    </div>
  );
}

interface ScanHealthBarProps {
  providers: ScanHealthProvider[];
  graphConsistency?: ScanHealthReport['graphConsistency'];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

function ScanHealthBar({
  providers,
  graphConsistency,
  expanded,
  onExpandedChange,
}: ScanHealthBarProps) {
  const latestScanAt = getLatestScanAt(providers);
  const issueCount = providers.reduce((sum, provider) => sum + (provider.errors?.length ?? 0), 0);

  return (
    <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Santé du scan
          </span>
          {providers.length > 0 ? (
            providers.map((provider) => <ProviderHealthChip key={provider.name} provider={provider} />)
          ) : (
            <div className="inline-flex h-8 items-center rounded-full border border-dashed px-3 text-xs text-muted-foreground">
              Aucun fournisseur configuré
            </div>
          )}
          <div className="inline-flex h-8 items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 text-xs font-medium whitespace-nowrap">
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Scan : {latestScanAt ? formatRelativeTime(latestScanAt) : 'jamais'}</span>
          </div>
          {issueCount > 0 && (
            <div className="inline-flex h-8 items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-medium text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{issueCount} alerte{issueCount > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => onExpandedChange(!expanded)}
          aria-label={expanded ? 'Masquer les détails du scan' : 'Afficher les détails du scan'}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {expanded && (
        <div className="grid gap-2 border-t bg-muted/20 px-4 py-3 md:grid-cols-2 xl:grid-cols-4">
          {providers.map((provider) => {
            const resourceCount = Object.values(provider.resourceCounts ?? {}).reduce(
              (sum, value) => sum + (Number.isFinite(value) ? value : 0),
              0,
            );

            return (
              <div key={provider.name} className="rounded-xl border bg-card/80 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2.5 w-2.5 rounded-full', getProviderStatusDotClass(provider.status))} />
                    <span className="font-semibold">{provider.name}</span>
                  </div>
                  <Badge variant={getProviderStatusBadge(provider.status)}>
                    {getProviderStatusLabel(provider.status)}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <p>Couverture : {Math.round(provider.coveragePercentage ?? 0)}%</p>
                  <p>Dernier scan : {provider.lastScanAt ? formatRelativeTime(provider.lastScanAt) : 'jamais'}</p>
                  <p>Ressources détectées : {resourceCount}</p>
                  {(provider.errors ?? []).slice(0, 2).map((err: ScanHealthIssue) => (
                    <p key={`${provider.name}-${err.code}-${err.message}`} className="text-rose-600 dark:text-rose-300">
                      {err.code}: {err.message}
                    </p>
                  ))}
                </div>
              </div>
            );
          })}

          {graphConsistency && (
            <div className="rounded-xl border bg-card/80 p-3 text-xs">
              <p className="font-semibold">Cohérence graphe</p>
              <div className="mt-2 space-y-1 text-muted-foreground">
                <p>Orphelins: {graphConsistency.orphanNodes}</p>
                <p>Reverse manquants: {graphConsistency.missingReverseEdges}</p>
                <p>Nœuds stale : {graphConsistency.staleNodes}</p>
                <p>Total nœuds : {graphConsistency.totalNodes}</p>
                <p>Total dépendances : {graphConsistency.totalEdges}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatMoneyCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

export function DiscoveryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const tenantScope = getCredentialScopeKey();
  const [searchParams] = useSearchParams();
  const { nodes, edges, allNodes, allEdges, isLoading: graphLoading } = useGraph();
  const { layout, selectedNodeId, setSelectedNode } = useGraphStore();
  const { isScanning, currentJob } = useDiscoveryStore();
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isScanHealthExpanded, setIsScanHealthExpanded] = useState(false);
  const [fitViewNonce, setFitViewNonce] = useState(0);
  const [showInfrastructure, setShowInfrastructure] = useState(false);
  const [colorByBusinessFlow, setColorByBusinessFlow] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [showPostScanOnboarding, setShowPostScanOnboarding] = useState(false);
  const [financialWizardOpen, setFinancialWizardOpen] = useState(false);
  const [postScanStep, setPostScanStep] = useState<1 | 2 | 3>(1);
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const processedCompletedJobRef = useRef<string | null>(null);
  const cloudProviderConfigs = useMemo(() => loadCloudProviderConfigs(tenantScope), [tenantScope]);
  const cloudScanProviders = useMemo(
    () => buildCloudProviderScanPayload(cloudProviderConfigs),
    [cloudProviderConfigs],
  );
  const hasCloudProvidersConfigured = cloudScanProviders.length > 0;

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
  const resilienceScoreQuery = useResilienceScore();

  const flows = useMemo(() => flowsQuery.data ?? [], [flowsQuery.data]);
  const serviceOnlyNodeCount = useMemo(
    () => filterServiceNodes(allNodes, false).length,
    [allNodes],
  );

  const displayedNodes = useMemo(
    () => filterServiceNodes(nodes, showInfrastructure),
    [nodes, showInfrastructure],
  );
  const displayedNodeIds = useMemo(
    () => new Set(displayedNodes.map((node) => node.id)),
    [displayedNodes],
  );
  const displayedEdges = useMemo(
    () => edges.filter((edge) => displayedNodeIds.has(edge.source) && displayedNodeIds.has(edge.target)),
    [edges, displayedNodeIds],
  );

  const displayedAllNodes = useMemo(
    () => filterServiceNodes(allNodes, showInfrastructure),
    [allNodes, showInfrastructure],
  );
  const displayedAllNodeIds = useMemo(
    () => new Set(displayedAllNodes.map((node) => node.id)),
    [displayedAllNodes],
  );
  const displayedAllEdges = useMemo(
    () => allEdges.filter((edge) => displayedAllNodeIds.has(edge.source) && displayedAllNodeIds.has(edge.target)),
    [allEdges, displayedAllNodeIds],
  );

  const selectedNode = displayedAllNodes.find((n) => n.id === selectedNodeId) || allNodes.find((n) => n.id === selectedNodeId);

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
          flowTooltip: 'Aucun flux métier détecté sur ce nœud',
        };
      }

      const colors = Array.from(new Set(linked.map((item) => item.color)));
      const flowNames = linked.map((item) => item.flowName);
      const totalContribution = linked.reduce((sum, item) => sum + item.contribution, 0);

      return {
        customBorderColor: colors[0],
        flowStripeColors: colors,
        flowTooltip: `${flowNames.join(', ')} | coût/h : ${formatMoneyCompact(totalContribution)}`,
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
    mutationFn: () => {
      if (cloudScanProviders.length === 0) {
        throw new Error('Aucun fournisseur cloud configuré');
      }
      return discoveryApi.launchScan({
        providers: cloudScanProviders,
        options: { inferDependencies: true },
      });
    },
    onSuccess: (res) => {
      setScanJobId(res.data.jobId);
      toast.success('Scan lancé');
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Erreur lors du lancement du scan';
      toast.error(message);
    },
  });

  const confirmEdgeMutation = useMutation({
    mutationFn: (edgeId: string) => discoveryApi.confirmEdge(edgeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      toast.success('Dépendance confirmée');
    },
  });

  const rejectEdgeMutation = useMutation({
    mutationFn: (edgeId: string) => discoveryApi.rejectEdge(edgeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      toast.success('Dépendance rejetée');
    },
  });

  const updateBusinessNameMutation = useMutation({
    mutationFn: ({ nodeId, businessName }: { nodeId: string; businessName: string | null }) =>
      discoveryApi.updateBusinessName(nodeId, businessName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['graph-flow-editor', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['business-flows', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['recommendations', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['recommendations-summary', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['bia-entries', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['bia-summary', tenantScope] });
      queryClient.invalidateQueries({ queryKey: ['spofs'] });
      toast.success('Nom mÃ©tier mis Ã  jour');
    },
    onError: () => {
      toast.error('Impossible de mettre Ã  jour le nom mÃ©tier');
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

  const inferredCount = displayedAllEdges.filter((e) => e.inferred && !e.confirmed).length;
  const spofCount = displayedAllNodes.filter((node) => node.isSPOF).length;
  const resilienceScore = Math.round(resilienceScoreQuery.data?.overall ?? 0);
  const scanProviders = healthQuery.data?.providers ?? [];
  const graphConsistency = healthQuery.data?.graphConsistency;
  const financeOnboardingDoneKey = `stronghold:finance-onboarding:done:${tenantScope}`;

  useEffect(() => {
    if (currentJob?.status !== 'completed' || !currentJob.id) return;
    if (processedCompletedJobRef.current === currentJob.id) return;
    processedCompletedJobRef.current = currentJob.id;

    if (localStorage.getItem(financeOnboardingDoneKey) === '1') return;
    const timeout = window.setTimeout(() => {
      setPostScanStep(1);
      setShowPostScanOnboarding(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [currentJob?.id, currentJob?.status, financeOnboardingDoneKey]);

  const completeFinanceOnboarding = useCallback(() => {
    localStorage.setItem(financeOnboardingDoneKey, '1');
    setPostScanStep(3);
    setFinancialWizardOpen(false);
  }, [financeOnboardingDoneKey]);

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
      toast.error('Impossible d’activer le mode plein écran');
    }
  }, []);

  const handleAutoLayout = useCallback(() => {
    setFitViewNonce((value) => value + 1);
  }, []);

  const handleGraphContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
  }, []);

  useEffect(() => {
    if (!contextMenuPosition) return;
    const closeMenu = () => setContextMenuPosition(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenuPosition]);

  if (graphLoading && !isScanning) {
    return <LoadingState variant="skeleton" message="Chargement du graphe..." count={5} />;
  }

  // Scanning phase
  if (isScanning && currentJob) {
    const adapters = currentJob.adapters || [];
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Scan en cours...
              ({adapters.filter((a) => a.status === 'completed').length}/{adapters.length} adapters)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {adapters.map((adapter) => (
              <div key={adapter.adapter} className="flex items-center gap-3">
                {adapter.status === 'completed' ? (
                  <Check className="h-4 w-4 text-resilience-high" />
                ) : adapter.status === 'running' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : adapter.status === 'failed' ? (
                  <AlertTriangle className="h-4 w-4 text-severity-critical" />
                ) : adapter.status === 'skipped' ? (
                  <div className="h-4 w-4 rounded-full border border-muted-foreground/60 bg-muted" />
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
              <span>{currentJob.nodesFound} nœuds</span>
              <span>{currentJob.edgesFound} dépendances</span>
              <span>{currentJob.inferredEdges} inférées</span>
            </div>
          </CardContent>
        </Card>

        {/* Show graph building up */}
        {displayedAllNodes.length > 0 && (
          <div className="h-[500px] rounded-lg border">
            <InfraGraph
              infraNodes={displayedAllNodes}
              infraEdges={displayedAllEdges}
              layout={layout}
              showMiniMap={showMiniMap}
              fitViewNonce={fitViewNonce}
              enableNetworkGrouping
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
        title={hasCloudProvidersConfigured ? 'Aucune infrastructure découverte' : 'Aucun fournisseur cloud configuré'}
        description={
          hasCloudProvidersConfigured
            ? 'Lancez un scan pour découvrir automatiquement votre infrastructure.'
            : 'Configurez au moins un provider cloud pour lancer la découverte.'
        }
        actionLabel={hasCloudProvidersConfigured ? 'Lancer un scan' : 'Configurer un fournisseur'}
        onAction={() => {
          if (hasCloudProvidersConfigured) {
            launchScanMutation.mutate();
            return;
          }
          navigate('/settings?tab=cloud');
        }}
      />
    );
  }

  // Validation phase
  return (
    <div className="-m-6 flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-background">
      <ScanHealthBar
        providers={scanProviders}
        graphConsistency={graphConsistency}
        expanded={isScanHealthExpanded}
        onExpandedChange={setIsScanHealthExpanded}
      />

      <div
        ref={graphContainerRef}
        className="relative flex flex-1 min-h-0 overflow-hidden bg-background"
      >
        <div className="absolute inset-x-3 top-3 z-20 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <GraphControls
            compact
            className="pointer-events-auto w-full xl:max-w-[440px]"
            onAutoLayout={handleAutoLayout}
          />

          <div
            className={cn(
              DISCOVERY_OVERLAY_SURFACE,
              'pointer-events-auto flex flex-wrap items-center justify-end gap-2 p-2 xl:max-w-[48rem]',
            )}
          >
            <div className="inline-flex items-center rounded-lg border bg-background/60 p-0.5">
              <Button
                variant={!showInfrastructure ? 'default' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={() => setShowInfrastructure(false)}
              >
                Services ({serviceOnlyNodeCount})
              </Button>
              <Button
                variant={showInfrastructure ? 'default' : 'ghost'}
                size="sm"
                className="h-8"
                onClick={() => setShowInfrastructure(true)}
              >
                Infrastructure ({allNodes.length})
              </Button>
            </div>

            <Button
              variant={colorByBusinessFlow ? 'default' : 'outline'}
              size="sm"
              className="h-8"
              onClick={() => setColorByBusinessFlow((value) => !value)}
            >
              Flux métier
            </Button>

            <Button
              variant={showMiniMap ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setShowMiniMap((value) => !value)}
              title="Afficher la minimap"
            >
              <MapIcon className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={handleToggleFullscreen}
              title={isFullScreen ? 'Quitter le plein écran' : 'Mode plein écran'}
            >
              {isFullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>

            {hasCloudProvidersConfigured ? (
              <Button
                size="sm"
                className="h-8"
                onClick={() => launchScanMutation.mutate()}
                disabled={launchScanMutation.isPending}
              >
                Relancer le scan
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => navigate('/settings?tab=cloud')}
              >
                Configurer un fournisseur
              </Button>
            )}
          </div>
        </div>

        <div className="absolute bottom-3 left-3 z-20 flex w-[calc(100%-1.5rem)] max-w-[34rem] flex-col gap-2 sm:w-auto">
          <div className={cn(DISCOVERY_OVERLAY_SURFACE, 'hidden px-3 py-2 lg:block')}>
            <GraphLegend compact />
          </div>

          <div className={cn(DISCOVERY_OVERLAY_SURFACE, 'px-3 py-3')}>
            <div className="flex items-start justify-between gap-3">
              <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-xs sm:text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {showInfrastructure ? 'Ressources' : 'Services'}
                  </p>
                  <p className="font-semibold">{displayedAllNodes.length}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Dépendances</p>
                  <p className="font-semibold">{displayedAllEdges.length}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">SPOF</p>
                  <p className="font-semibold">{spofCount}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Résilience</p>
                  <p className="font-semibold">{resilienceScore}/100</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {inferredCount > 0 && (
                  <Badge variant="secondary" className="hidden sm:inline-flex">
                    {inferredCount} dépendances à valider
                  </Badge>
                )}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Détails techniques">
                      <Info className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Détails techniques
                    </p>
                    <div className="mt-2 space-y-1 text-xs">
                      <p>Orphans: {graphConsistency?.orphanNodes ?? 0}</p>
                      <p>Reverse manquants: {graphConsistency?.missingReverseEdges ?? 0}</p>
                      <p>Stale: {graphConsistency?.staleNodes ?? 0}</p>
                      <p>Total nœuds : {graphConsistency?.totalNodes ?? allNodes.length}</p>
                      <p>Total edges: {graphConsistency?.totalEdges ?? allEdges.length}</p>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {inferredCount > 0 && (
              <Badge variant="secondary" className="mt-2 sm:hidden">
                {inferredCount} dépendances à valider
              </Badge>
            )}
          </div>
        </div>

        <div className="relative flex-1 min-h-0" onContextMenu={handleGraphContextMenu}>
          <InfraGraph
            infraNodes={displayedNodes}
            infraEdges={displayedEdges}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            layout={layout}
            getNodeDataOverrides={getNodeDataOverrides}
            getEdgeStyleOverrides={getEdgeStyleOverrides}
            showMiniMap={showMiniMap}
            fitViewNonce={fitViewNonce}
            enableDependencyHighlight
            enableNetworkGrouping
          />

          {contextMenuPosition && (
            <div
              className="fixed z-50 min-w-[210px] rounded-md border bg-popover p-1 shadow-md"
              style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => {
                  setColorByBusinessFlow((value) => !value);
                  setContextMenuPosition(null);
                }}
              >
                {colorByBusinessFlow ? 'Désactiver la coloration métier' : 'Colorer par flux métier'}
              </button>
            </div>
          )}

          {edgePopover && (
            <Popover open onOpenChange={() => setEdgePopover(null)}>
              <PopoverTrigger asChild>
                <span />
              </PopoverTrigger>
              <PopoverContent>
                <p className="mb-2 text-sm font-semibold">Dépendance inférée</p>
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

        {selectedNode && (
          <div className="absolute inset-y-0 right-0 z-30">
            <NodeDetailPanel
              node={selectedNode}
              edges={displayedAllEdges}
              allNodes={displayedAllNodes}
              onClose={() => setSelectedNode(null)}
              onSaveBusinessName={(nodeId, businessName) =>
                updateBusinessNameMutation.mutateAsync({ nodeId, businessName })
              }
              savingNodeId={
                updateBusinessNameMutation.isPending
                  ? updateBusinessNameMutation.variables?.nodeId ?? null
                  : null
              }
              className="w-screen max-w-[420px] shadow-2xl"
            />
          </div>
        )}
      </div>

      <Dialog open={showPostScanOnboarding} onOpenChange={setShowPostScanOnboarding}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Onboarding post-scan</DialogTitle>
            <DialogDescription>
              Étape {postScanStep} / 3 - Activez l’analyse d’impact business après votre premier scan.
            </DialogDescription>
          </DialogHeader>

          {postScanStep === 1 && (
            <div className="space-y-3 text-sm">
              <p className="font-medium">
                Scan réussi : {currentJob?.nodesFound ?? allNodes.length} ressources découvertes, {spofCount} SPOF détectés.
              </p>
              <p className="text-muted-foreground">
                Votre cartographie technique est prête.
              </p>
            </div>
          )}

          {postScanStep === 2 && (
            <div className="space-y-3 text-sm">
              <p className="font-medium">Configurez votre profil financier pour activer l’impact business.</p>
              <p className="text-muted-foreground">
                Le wizard financier est accessible ici pendant l onboarding, puis uniquement dans Settings.
              </p>
            </div>
          )}

          {postScanStep === 3 && (
            <div className="space-y-3 text-sm">
              <p className="font-medium">C’est prêt. Explorez vos résultats.</p>
              <p className="text-muted-foreground">
                Vous pourrez modifier le profil financier uniquement depuis Paramètres.
              </p>
            </div>
          )}

          <DialogFooter>
            {postScanStep === 1 && (
              <Button onClick={() => setPostScanStep(2)}>Continuer</Button>
            )}
            {postScanStep === 2 && (
              <div className="flex w-full justify-between gap-2">
                <Button variant="outline" onClick={() => completeFinanceOnboarding()}>
                  Configurer plus tard
                </Button>
                <Button onClick={() => setFinancialWizardOpen(true)}>
                  Configurer le profil financier
                </Button>
              </div>
            )}
            {postScanStep === 3 && (
              <Button
                onClick={() => {
                  setShowPostScanOnboarding(false);
                  navigate('/dashboard');
                }}
              >
                Explorer le tableau de bord
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FinancialOnboardingWizard
        open={financialWizardOpen}
        onOpenChange={setFinancialWizardOpen}
        onCompleted={completeFinanceOnboarding}
      />
    </div>
  );
}

