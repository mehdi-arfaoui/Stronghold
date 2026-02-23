import { memo } from 'react';
import { Handle, Position, type NodeProps, useStore } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NodeIcon } from './NodeIcon';
import { NODE_COLOR_MAP } from '@/lib/node-colors';
import type { NodeType, NodeStatus } from '@/types/graph.types';

export interface InfraNodeData {
  label: string;
  nodeType: NodeType;
  provider?: string;
  region?: string;
  isSPOF?: boolean;
  status?: NodeStatus;
  criticality?: number;
  customBorderColor?: string;
  dimmed?: boolean;
  flowStripeColors?: string[];
  flowRole?: string | null;
  flowTooltip?: string;
  showUnknownCostIndicator?: boolean;
  [key: string]: unknown;
}

type InfraNodeProps = NodeProps & { data: InfraNodeData };

function useZoomBucket(): 'tiny' | 'compact' | 'full' {
  return useStore((state) => {
    const zoom = Number(state?.transform?.[2] ?? 1);
    if (zoom < 0.4) return 'tiny';
    if (zoom < 0.7) return 'compact';
    return 'full';
  });
}

export const NodeCard = memo(function NodeCard({ data, selected }: InfraNodeProps) {
  const zoomBucket = useZoomBucket();
  const {
    label,
    nodeType,
    provider,
    region,
    isSPOF,
    status,
    customBorderColor,
    dimmed,
    flowStripeColors,
    flowRole,
    flowTooltip,
    showUnknownCostIndicator,
  } = data;
  const borderColor = customBorderColor || NODE_COLOR_MAP[nodeType] || '#6b7280';
  const stripeColors = Array.isArray(flowStripeColors)
    ? flowStripeColors.filter((color) => typeof color === 'string' && color.trim().length > 0)
    : [];
  const flowStripeBackground =
    stripeColors.length <= 1
      ? stripeColors[0]
      : `linear-gradient(90deg, ${stripeColors.join(', ')})`;

  if (zoomBucket === 'tiny') {
    return (
      <div className="relative">
        <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-muted-foreground/50" />
        <div
          className={cn(
            'h-3 w-3 rounded-full',
            status === 'down'
              ? 'bg-severity-critical'
              : status === 'degraded'
                ? 'bg-severity-medium'
                : 'bg-primary/80',
            selected && 'ring-2 ring-primary',
            dimmed && 'opacity-40',
          )}
          style={{ boxShadow: `0 0 0 1px ${borderColor}` }}
          title={label}
        />
        <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-muted-foreground/50" />
      </div>
    );
  }

  if (zoomBucket === 'compact') {
    return (
      <div
        className={cn(
          'rounded border bg-card px-2 py-1 text-xs shadow-sm',
          selected && 'ring-2 ring-primary ring-offset-2',
          status === 'down' && 'border-severity-critical bg-severity-critical/10',
          status === 'degraded' && 'border-severity-medium bg-severity-medium/10',
          dimmed && 'opacity-50 saturate-50',
        )}
        style={{ borderColor: status === 'down' || status === 'degraded' ? undefined : borderColor }}
        title={typeof flowTooltip === 'string' ? flowTooltip : undefined}
      >
        <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-muted-foreground/50" />
        <div className="flex items-center gap-1.5">
          <NodeIcon type={nodeType} className="h-3.5 w-3.5 shrink-0" style={{ color: borderColor }} />
          <span className="max-w-[90px] truncate font-medium">{label}</span>
          {isSPOF && <AlertTriangle className="h-3 w-3 text-severity-critical" />}
        </div>
        <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-muted-foreground/50" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-shadow hover:shadow-md',
        selected && 'ring-2 ring-primary ring-offset-2',
        status === 'down' && 'node-pulse border-severity-critical bg-severity-critical/5',
        status === 'degraded' && 'border-severity-medium bg-severity-medium/5',
        dimmed && 'opacity-50 saturate-50',
      )}
      style={{
        borderColor: status === 'down' ? undefined : status === 'degraded' ? undefined : borderColor,
        minWidth: 160,
      }}
      title={typeof flowTooltip === 'string' ? flowTooltip : undefined}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-muted-foreground/50" />

      {flowStripeBackground && (
        <div
          className="mb-2 h-1 rounded-sm"
          style={{ background: flowStripeBackground }}
        />
      )}

      <div className="flex items-center gap-2">
        <NodeIcon type={nodeType} className="h-4 w-4 shrink-0" style={{ color: borderColor }} />
        <span className="truncate text-sm font-medium">{label}</span>
      </div>

      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <span>{nodeType}</span>
        {region && (
          <>
            <span className="text-muted-foreground/50">&middot;</span>
            <span>{region}</span>
          </>
        )}
      </div>

      {isSPOF && (
        <div className="mt-1 flex items-center gap-1 text-xs font-medium text-severity-critical">
          <AlertTriangle className="h-3 w-3" />
          <span>SPOF</span>
        </div>
      )}

      {status === 'down' && (
        <div className="mt-1 text-xs font-bold text-severity-critical">HORS SERVICE</div>
      )}
      {status === 'degraded' && (
        <div className="mt-1 text-xs font-bold text-severity-medium">DEGRADE</div>
      )}

      {provider && (
        <div className="mt-1 text-xs text-muted-foreground/60">{provider}</div>
      )}

      {(flowRole || showUnknownCostIndicator) && (
        <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          {flowRole && <span>{flowRole}</span>}
          {showUnknownCostIndicator && (
            <span className="rounded-sm border border-dashed px-1">COUT ?</span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-muted-foreground/50" />
    </div>
  );
});

