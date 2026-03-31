import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Boxes,
  Cable,
  Cloud,
  Database,
  HardDrive,
  Network,
  Server,
  Shield,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import { cn, getStatusColor } from '@/lib/utils';

export type GraphVisualData = Record<string, unknown> & {
  readonly label: string;
  readonly subtitle: string;
  readonly nodeType: string;
  readonly status: string;
  readonly count?: number;
  readonly emphasis?: string;
};

function resolveIcon(nodeType: string): LucideIcon {
  const normalized = nodeType.toLowerCase();
  if (
    normalized.includes('db') ||
    normalized.includes('database') ||
    normalized.includes('rds') ||
    normalized.includes('dynamo')
  ) {
    return Database;
  }
  if (normalized.includes('cache') || normalized.includes('redis') || normalized.includes('elasticache')) {
    return Boxes;
  }
  if (
    normalized.includes('vpc') ||
    normalized.includes('subnet') ||
    normalized.includes('network') ||
    normalized.includes('route')
  ) {
    return Network;
  }
  if (normalized.includes('s3') || normalized.includes('efs') || normalized.includes('storage')) {
    return HardDrive;
  }
  if (
    normalized.includes('lambda') ||
    normalized.includes('serverless') ||
    normalized.includes('sns') ||
    normalized.includes('sqs')
  ) {
    return Cloud;
  }
  if (normalized.includes('security') || normalized.includes('firewall')) {
    return Shield;
  }
  if (normalized.includes('load') || normalized.includes('gateway')) {
    return Cable;
  }
  if (normalized.includes('eks') || normalized.includes('cluster')) {
    return Workflow;
  }
  return Server;
}

export function GraphNode({ data, selected }: NodeProps): JSX.Element {
  const nodeData = data as GraphVisualData;
  const Icon = resolveIcon(nodeData.nodeType);

  return (
    <div
      className={cn(
        'min-w-[210px] rounded-2xl border-2 bg-card/95 px-4 py-3 shadow-panel transition-colors duration-150',
        selected ? 'ring-2 ring-accent/35' : '',
      )}
      style={{ borderColor: getStatusColor(nodeData.status) }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-accent/70" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-accent/70" />
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-elevated p-2 text-accent">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{nodeData.label}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{nodeData.subtitle}</div>
          {nodeData.emphasis ? <div className="mt-2 text-xs text-accent-soft-foreground">{nodeData.emphasis}</div> : null}
        </div>
      </div>
    </div>
  );
}
