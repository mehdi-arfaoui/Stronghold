import { MiniMap } from '@xyflow/react';
import { getTierColor } from '@/lib/graph-visuals';
import { NODE_COLOR_MAP } from '@/lib/node-colors';
import type { NodeType } from '@/types/graph.types';

export function GraphMinimap() {
  return (
    <MiniMap
      nodeColor={(node) => {
        const data = (node.data as { nodeType?: NodeType; tier?: number; groupType?: string }) || {};
        if (node.type === 'groupZone' || data.groupType) return 'transparent';
        if (typeof data.tier === 'number') {
          return getTierColor(data.tier);
        }
        const nodeType = data.nodeType;
        if (nodeType && nodeType in NODE_COLOR_MAP) {
          return NODE_COLOR_MAP[nodeType];
        }
        return '#6b7280';
      }}
      maskColor="rgba(15, 23, 42, 0.08)"
      position="bottom-right"
      zoomable
      style={{
        width: 200,
        height: 150,
        border: '1px solid rgba(15, 23, 42, 0.12)',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.92)',
        boxShadow: '0 6px 24px rgba(15, 23, 42, 0.08)',
      }}
      pannable
    />
  );
}
