import { memo } from 'react';
import { AlertTriangle, Layers3 } from 'lucide-react';
import { Handle, Position, type NodeProps, useStore } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface ClusterNodeData {
  label: string;
  count: number;
  criticalCount: number;
  hasSpof: boolean;
  groupKey: string;
}

type ClusterNodeProps = NodeProps & { data: ClusterNodeData };

function useZoomBucket(): 'tiny' | 'compact' | 'full' {
  return useStore((state) => {
    const zoom = Number(state?.transform?.[2] ?? 1);
    if (zoom < 0.4) return 'tiny';
    if (zoom < 0.7) return 'compact';
    return 'full';
  });
}

export const ClusterNodeCard = memo(function ClusterNodeCard({ data, selected }: ClusterNodeProps) {
  const zoomBucket = useZoomBucket();

  if (zoomBucket === 'tiny') {
    return (
      <div className="relative">
        <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-muted-foreground/60" />
        <div
          className={cn(
            'h-4 w-4 rounded bg-primary/80 ring-1 ring-primary/40',
            selected && 'ring-2 ring-primary',
          )}
          title={`${data.label} (${data.count})`}
        />
        <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-muted-foreground/60" />
      </div>
    );
  }

  if (zoomBucket === 'compact') {
    return (
      <div
        className={cn(
          'rounded border-2 border-primary/60 bg-primary/10 px-2 py-1 text-xs',
          selected && 'ring-2 ring-primary ring-offset-2',
        )}
      >
        <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-muted-foreground/60" />
        <div className="flex items-center gap-1">
          <Layers3 className="h-3.5 w-3.5 text-primary" />
          <span className="max-w-[120px] truncate font-medium">{data.label}</span>
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            {data.count}
          </Badge>
        </div>
        <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-muted-foreground/60" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'min-w-[220px] rounded-xl border-2 border-primary/70 bg-primary/10 px-3 py-2 shadow-sm transition-shadow hover:shadow-md',
        selected && 'ring-2 ring-primary ring-offset-2',
      )}
      title={`${data.label} - ${data.count} noeuds`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-muted-foreground/60" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">{data.label}</span>
        </div>
        <Badge variant="default">{data.count}</Badge>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{data.criticalCount} critiques</span>
        {data.hasSpof && (
          <span className="inline-flex items-center gap-1 text-severity-critical">
            <AlertTriangle className="h-3 w-3" />
            SPOF detecte
          </span>
        )}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Clic: ouvrir/fermer le cluster
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-muted-foreground/60" />
    </div>
  );
});

