import { memo } from 'react';
import { Handle, Position, type NodeProps, useStore } from '@xyflow/react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NodeIcon } from './NodeIcon';
import type { NodeType, NodeStatus } from '@/types/graph.types';
import {
  CATEGORY_COLORS,
  getTierColor,
  type GraphCategory,
} from '@/lib/graph-visuals';

export interface InfraNodeData {
  label: string;
  nodeType: NodeType;
  nodeTypeLabel?: string;
  category?: GraphCategory;
  serviceType?: string;
  tier?: number;
  blastRatio?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  provider?: string;
  region?: string;
  metadata?: Record<string, unknown>;
  isSPOF?: boolean;
  status?: NodeStatus;
  criticality?: number;
  customBorderColor?: string;
  dimmed?: boolean;
  flowStripeColors?: string[];
  flowRole?: string | null;
  flowTooltip?: string;
  showUnknownCostIndicator?: boolean;
  customOpacity?: number;
  disablePointerEvents?: boolean;
  [key: string]: unknown;
}

type InfraNodeProps = NodeProps & { data: InfraNodeData };

function useZoomBucket(): 'tiny' | 'compact' | 'full' {
  return useStore((state) => {
    const zoom = Number(state?.transform?.[2] ?? 1);
    if (zoom < 0.38) return 'tiny';
    if (zoom < 0.7) return 'compact';
    return 'full';
  });
}

export const NodeCard = memo(function NodeCard({ data, selected }: InfraNodeProps) {
  const zoomBucket = useZoomBucket();
  const {
    label,
    nodeType,
    nodeTypeLabel,
    category = 'external',
    serviceType,
    tier,
    nodeWidth,
    nodeHeight,
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

  const palette = CATEGORY_COLORS[category] || CATEGORY_COLORS.external;
  const borderColor = customBorderColor || palette.border;
  const width = Math.max(120, Number(nodeWidth || 160));
  const height = Math.max(50, Number(nodeHeight || 60));
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
            'h-4 w-4 rounded-sm border shadow-sm',
            selected && 'ring-2 ring-primary',
            dimmed && 'opacity-40',
          )}
          style={{
            background: palette.bg,
            borderColor: status === 'down' ? '#ef4444' : status === 'degraded' ? '#f59e0b' : borderColor,
          }}
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
          'rounded border px-2 py-1 text-xs shadow-sm',
          selected && 'ring-2 ring-primary ring-offset-2',
          dimmed && 'opacity-50 saturate-50',
        )}
        style={{
          width: Math.max(115, Math.floor(width * 0.82)),
          borderColor: status === 'down' ? '#ef4444' : status === 'degraded' ? '#f59e0b' : borderColor,
          background: palette.bg,
          color: palette.text,
        }}
        title={typeof flowTooltip === 'string' ? flowTooltip : undefined}
      >
        <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !bg-muted-foreground/50" />
        <div className="flex items-center gap-1.5">
          <NodeIcon type={nodeType} className="h-3.5 w-3.5 shrink-0" style={{ color: borderColor }} />
          <span className="max-w-[120px] truncate font-semibold">{label}</span>
          {isSPOF && <AlertTriangle className="h-3 w-3 text-severity-critical" />}
        </div>
        <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !bg-muted-foreground/50" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border-2 px-3 py-2 shadow-sm transition-shadow hover:shadow-md',
        selected && 'ring-2 ring-primary ring-offset-2',
        status === 'down' && 'node-pulse',
        dimmed && 'opacity-50 saturate-50',
      )}
      style={{
        width,
        minHeight: height,
        borderColor: status === 'down' ? '#ef4444' : status === 'degraded' ? '#f59e0b' : borderColor,
        background: palette.bg,
        color: palette.text,
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
        <span className="truncate text-sm font-semibold">{label}</span>
      </div>

      <div className="mt-1 flex items-center gap-1 text-[11px] opacity-85">
        <span>{serviceType || nodeTypeLabel || nodeType}</span>
        {tier && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
            style={{ backgroundColor: getTierColor(tier) }}
          >
            T{tier}
          </span>
        )}
        {region && <span className="truncate text-[10px] opacity-80">{region}</span>}
      </div>

      {isSPOF && (
        <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-[#fc8181]">
          <AlertTriangle className="h-3 w-3" />
          <span>SPOF</span>
        </div>
      )}

      {status === 'down' && (
        <div className="mt-1 text-xs font-bold text-[#fc8181]">HORS SERVICE</div>
      )}
      {status === 'degraded' && (
        <div className="mt-1 text-xs font-bold text-[#f6ad55]">DEGRADE</div>
      )}

      {provider && (
        <div className="mt-1 text-[10px] opacity-65">{provider}</div>
      )}

      {(flowRole || showUnknownCostIndicator) && (
        <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide opacity-70">
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
