import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { InfraGraph } from '@/components/graph/InfraGraph';
import type { InfraNode, InfraEdge, NodeStatus } from '@/types/graph.types';
import type { AffectedNode } from '@/types/simulation.types';

interface BeforeAfterGraphProps {
  nodes: InfraNode[];
  edges: InfraEdge[];
  affectedNodes: AffectedNode[];
}

export function BeforeAfterGraph({ nodes, edges, affectedNodes }: BeforeAfterGraphProps) {
  const [view, setView] = useState<'before' | 'after'>('after');

  const nodeStatuses = new Map<string, NodeStatus>();
  if (view === 'after') {
    affectedNodes.forEach((n) => {
      nodeStatuses.set(n.nodeId, n.status);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant={view === 'before' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('before')}
        >
          Avant
        </Button>
        <Button
          variant={view === 'after' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('after')}
        >
          Apres
        </Button>
      </div>
      <div className="h-[500px] rounded-lg border">
        <InfraGraph
          infraNodes={nodes}
          infraEdges={edges}
          nodeStatuses={nodeStatuses}
        />
      </div>
    </div>
  );
}
