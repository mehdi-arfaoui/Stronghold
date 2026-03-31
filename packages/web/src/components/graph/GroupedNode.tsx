import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Layers3 } from 'lucide-react';

import { cn, getStatusColor } from '@/lib/utils';

import type { GraphVisualData } from './GraphNode';

export function GroupedNode({ data, selected }: NodeProps): JSX.Element {
  const nodeData = data as GraphVisualData;

  return (
    <div
      className={cn(
        'min-w-[250px] rounded-2xl border-2 bg-card/95 px-4 py-3 shadow-panel transition-colors duration-150',
        selected ? 'ring-2 ring-accent/35' : '',
      )}
      style={{ borderColor: getStatusColor(nodeData.status) }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-accent/70" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-accent/70" />
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-accent-soft p-2 text-accent-soft-foreground">
          <Layers3 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{nodeData.label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{nodeData.subtitle}</div>
          <div className="mt-2 text-xs text-accent-soft-foreground">Click to expand this aggregate node.</div>
        </div>
      </div>
    </div>
  );
}
