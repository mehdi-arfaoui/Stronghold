import { useMemo, useState } from 'react';
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

  const nodeStatuses = useMemo(() => {
    const statuses = new Map<string, NodeStatus>();
    if (view !== 'after') return statuses;
    for (const node of affectedNodes) {
      statuses.set(node.nodeId, node.status);
    }
    return statuses;
  }, [affectedNodes, view]);

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
