import { useNavigate } from 'react-router-dom';
import { X, AlertTriangle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NodeIcon } from './NodeIcon';
import type { InfraNode, InfraEdge } from '@/types/graph.types';
import { cn } from '@/lib/utils';

interface NodeDetailPanelProps {
  node: InfraNode;
  edges: InfraEdge[];
  allNodes: InfraNode[];
  onClose: () => void;
  className?: string;
}

export function NodeDetailPanel({ node, edges, allNodes, onClose, className }: NodeDetailPanelProps) {
  const navigate = useNavigate();

  const relatedEdges = edges.filter((e) => e.source === node.id || e.target === node.id);
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const metadata = node.metadata && typeof node.metadata === 'object'
    ? (node.metadata as Record<string, unknown>)
    : {};
  const displayType = typeof metadata.awsService === 'string'
    ? metadata.awsService
    : typeof metadata.subType === 'string'
      ? metadata.subType
      : node.type;

  return (
    <div className={cn('flex h-full w-full flex-col border-l bg-card', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <NodeIcon type={node.type} className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">{node.name}</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* Basic info */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium">{displayType}</span>
            </div>
            {node.provider && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Provider</span>
                <span className="font-medium">{node.provider}</span>
              </div>
            )}
            {node.region && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Region</span>
                <span className="font-medium">{node.region}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">ID</span>
              <span className="max-w-[200px] truncate font-mono text-xs">{node.id}</span>
            </div>
          </div>

          <Separator />

          {/* Analysis */}
          <div>
            <h4 className="mb-3 text-sm font-semibold">Analyse</h4>
            <div className="space-y-3">
              {node.criticality !== undefined && (
                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Criticite</span>
                    <span className="font-medium">{node.criticality}/100</span>
                  </div>
                  <Progress value={node.criticality} className="h-2" />
                </div>
              )}
              {node.redundancy !== undefined && (
                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Redondance</span>
                    <span className="font-medium">{node.redundancy}/100</span>
                    {node.redundancy < 30 && <AlertTriangle className="h-3 w-3 text-severity-medium" />}
                  </div>
                  <Progress value={node.redundancy} className="h-2" />
                </div>
              )}
              {node.isSPOF && (
                <div className="flex items-center gap-2 rounded-md bg-severity-critical/10 p-2 text-sm text-severity-critical">
                  <AlertTriangle className="h-4 w-4" />
                  <span>SPOF — blast radius: {node.blastRadius || '?'} services</span>
                </div>
              )}
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Multi-AZ: </span>
                  <span className="font-medium">{node.multiAZ ? 'Oui' : 'Non'}</span>
                  {!node.multiAZ && <AlertTriangle className="ml-1 inline h-3 w-3 text-severity-medium" />}
                </div>
                <div>
                  <span className="text-muted-foreground">Replicas: </span>
                  <span className="font-medium">{node.replicas ?? 0}</span>
                  {(node.replicas ?? 0) === 0 && <AlertTriangle className="ml-1 inline h-3 w-3 text-severity-medium" />}
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Dependencies */}
          <div>
            <h4 className="mb-2 text-sm font-semibold">Dependances ({relatedEdges.length})</h4>
            <div className="space-y-1">
              {relatedEdges.map((edge) => {
                const targetId = edge.source === node.id ? edge.target : edge.source;
                const targetNode = nodeMap.get(targetId);
                return (
                  <div key={edge.id} className="flex items-center gap-2 rounded p-1.5 text-sm hover:bg-accent">
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="truncate">{targetNode?.name || targetId}</span>
                    <Badge variant="outline" className="ml-auto text-xs">
                      {edge.type}
                    </Badge>
                    {edge.inferred && (
                      <Badge variant="secondary" className="text-xs">infere</Badge>
                    )}
                  </div>
                );
              })}
              {relatedEdges.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucune dependance</p>
              )}
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <Button
            className="w-full"
            onClick={() => navigate(`/simulations?node=${node.id}`)}
          >
            Simuler la panne de ce noeud
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
