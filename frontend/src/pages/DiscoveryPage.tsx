import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, AlertTriangle, Loader2, Maximize2, Minimize2 } from 'lucide-react';
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
import { useGraph } from '@/hooks/useGraph';
import { useDiscovery } from '@/hooks/useDiscovery';
import { useGraphStore } from '@/stores/graph.store';
import { useDiscoveryStore } from '@/stores/discovery.store';
import { discoveryApi } from '@/api/discovery.api';
import type { InfraNode, InfraEdge } from '@/types/graph.types';

export function DiscoveryPage() {
  const queryClient = useQueryClient();
  const { nodes, edges, allNodes, allEdges, isLoading: graphLoading, availableTypes, availableProviders, availableRegions } = useGraph();
  const { layout, selectedNodeId, setSelectedNode } = useGraphStore();
  const { isScanning, currentJob } = useDiscoveryStore();
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const graphContainerRef = useRef<HTMLDivElement | null>(null);

  useDiscovery(scanJobId ?? undefined);

  const selectedNode = allNodes.find((n) => n.id === selectedNodeId);

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
            <InfraGraph infraNodes={allNodes} infraEdges={allEdges} layout={layout} />
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
      {/* Toolbar */}
      <GraphControls
        availableTypes={availableTypes}
        availableProviders={availableProviders}
        availableRegions={availableRegions}
      />

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
