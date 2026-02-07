import { MiniMap } from '@xyflow/react';
import { NODE_COLOR_MAP } from '@/lib/node-colors';
import type { NodeType } from '@/types/graph.types';

export function GraphMinimap() {
  return (
    <MiniMap
      nodeColor={(node) => {
        const nodeType = (node.data as { nodeType?: NodeType }).nodeType;
        if (nodeType && nodeType in NODE_COLOR_MAP) {
          return NODE_COLOR_MAP[nodeType];
        }
        return '#6b7280';
      }}
      maskColor="rgba(0, 0, 0, 0.1)"
      className="!bottom-4 !right-4 rounded-lg border shadow-sm"
      pannable
      zoomable
    />
  );
}
