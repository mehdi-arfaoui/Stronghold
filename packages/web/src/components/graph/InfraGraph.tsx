import dagre from 'dagre';
import {
  Background,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';

import { useAppStore } from '@/store/app-store';
import { themeColor } from '@/lib/utils';
import { GraphNode, type GraphVisualData } from './GraphNode';
import { GroupedNode } from './GroupedNode';

interface GraphPalette {
  readonly canvas: string;
  readonly backgroundPattern: string;
  readonly edgeBase: string;
  readonly edgeActive: string;
  readonly edgeLabel: string;
  readonly edgeLabelActive: string;
  readonly edgeLabelBackground: string;
  readonly edgeLabelBackgroundActive: string;
}

function getGraphPalette(theme: 'dark' | 'light'): GraphPalette {
  if (theme === 'light') {
    return {
      canvas: themeColor('elevated'),
      backgroundPattern: themeColor('border-strong', 0.55),
      edgeBase: themeColor('subtle-foreground', 0.52),
      edgeActive: themeColor('accent'),
      edgeLabel: themeColor('muted-foreground'),
      edgeLabelActive: themeColor('foreground'),
      edgeLabelBackground: themeColor('card', 0.96),
      edgeLabelBackgroundActive: themeColor('accent-soft', 0.98),
    };
  }

  return {
    canvas: themeColor('elevated'),
    backgroundPattern: themeColor('border-strong', 0.42),
    edgeBase: themeColor('muted-foreground', 0.58),
    edgeActive: themeColor('accent'),
    edgeLabel: themeColor('muted-foreground'),
    edgeLabelActive: themeColor('foreground'),
    edgeLabelBackground: themeColor('overlay', 0.92),
    edgeLabelBackgroundActive: themeColor('accent-soft', 0.9),
  };
}

function layoutNodes(
  nodes: readonly Node<GraphVisualData>[],
  edges: readonly Edge[],
  selectedNodeId: string | null,
): Node<GraphVisualData>[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    ranksep: 120,
    nodesep: 60,
    marginx: 20,
    marginy: 20,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: node.type === 'groupedNode' ? 260 : 220,
      height: node.type === 'groupedNode' ? 92 : 84,
    });
  });
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  return nodes.map((node) => {
    const positioned = graph.node(node.id);
    const width = node.type === 'groupedNode' ? 260 : 220;
    const height = node.type === 'groupedNode' ? 92 : 84;
    return {
      ...node,
      position: {
        x: positioned.x - width / 2,
        y: positioned.y - height / 2,
      },
      selected: node.id === selectedNodeId,
    };
  });
}

function GraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  focusRequest,
  command,
  onNodeSelect,
  onGroupToggle,
}: {
  readonly nodes: readonly Node<GraphVisualData>[];
  readonly edges: readonly Edge[];
  readonly selectedNodeId: string | null;
  readonly focusRequest: { readonly id: string; readonly nonce: number } | null;
  readonly command: { readonly type: 'zoom-in' | 'zoom-out' | 'fit'; readonly nonce: number } | null;
  readonly onNodeSelect: (nodeId: string) => void;
  readonly onGroupToggle: (groupId: string) => void;
}): JSX.Element {
  const reactFlow = useReactFlow();
  const theme = useAppStore((state) => state.theme);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const layoutedNodes = useMemo(
    () => layoutNodes(nodes, edges, selectedNodeId),
    [edges, nodes, selectedNodeId],
  );

  const palette = useMemo(
    () => getGraphPalette(theme),
    [theme],
  );

  const activeNodeId = hoveredNodeId ?? selectedNodeId;

  const styledEdges = useMemo(
    () =>
      edges.map((edge) => {
        const isRelated = activeNodeId != null && (edge.source === activeNodeId || edge.target === activeNodeId);
        const hasContext = activeNodeId != null;
        const edgeColor = isRelated ? palette.edgeActive : palette.edgeBase;
        const labelBgPadding: [number, number] = isRelated ? [10, 6] : [8, 4];

        return {
          ...edge,
          type: 'smoothstep',
          animated: false,
          labelShowBg: true,
          labelBgPadding,
          labelBgBorderRadius: 999,
          labelBgStyle: {
            fill: isRelated ? palette.edgeLabelBackgroundActive : palette.edgeLabelBackground,
            opacity: hasContext && !isRelated ? 0.48 : 0.94,
          },
          labelStyle: {
            fill: isRelated ? palette.edgeLabelActive : palette.edgeLabel,
            fontSize: 11,
            fontWeight: isRelated ? 600 : 500,
            opacity: hasContext && !isRelated ? 0.55 : 1,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeColor,
          },
          style: {
            stroke: edgeColor,
            strokeWidth: isRelated ? 2.8 : 1.7,
            opacity: hasContext && !isRelated ? 0.22 : 0.78,
            transition: 'stroke 150ms ease, opacity 150ms ease, stroke-width 150ms ease',
          },
        };
      }),
    [activeNodeId, edges, palette],
  );

  useEffect(() => {
    reactFlow.fitView({ padding: 0.18, duration: 250 });
  }, [layoutedNodes, reactFlow]);

  useEffect(() => {
    if (!command) {
      return;
    }

    if (command.type === 'fit') {
      reactFlow.fitView({ padding: 0.18, duration: 250 });
      return;
    }
    if (command.type === 'zoom-in') {
      reactFlow.zoomIn({ duration: 200 });
      return;
    }
    reactFlow.zoomOut({ duration: 200 });
  }, [command, reactFlow]);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }

    const targetNode = layoutedNodes.find((node) => node.id === focusRequest.id);
    if (!targetNode) {
      return;
    }

    reactFlow.setCenter(targetNode.position.x + 110, targetNode.position.y + 42, {
      zoom: 1.18,
      duration: 250,
    });
  }, [focusRequest, layoutedNodes, reactFlow]);

  useEffect(() => {
    if (!hoveredNodeId) {
      return;
    }

    if (!nodes.some((node) => node.id === hoveredNodeId)) {
      setHoveredNodeId(null);
    }
  }, [hoveredNodeId, nodes]);

  return (
    <ReactFlow
      nodes={layoutedNodes}
      edges={styledEdges}
      fitView
      colorMode={theme}
      nodesDraggable={false}
      nodesConnectable={false}
      style={{ backgroundColor: palette.canvas }}
      nodeTypes={{
        graphNode: GraphNode,
        groupedNode: GroupedNode,
      }}
      onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
      onNodeMouseLeave={() => setHoveredNodeId(null)}
      onPaneMouseLeave={() => setHoveredNodeId(null)}
      onNodeClick={(_, node) => {
        if (node.type === 'groupedNode') {
          onGroupToggle(node.id);
          return;
        }
        onNodeSelect(node.id);
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background color={palette.backgroundPattern} gap={24} />
    </ReactFlow>
  );
}

export function InfraGraph(props: {
  readonly nodes: readonly Node<GraphVisualData>[];
  readonly edges: readonly Edge[];
  readonly selectedNodeId: string | null;
  readonly focusRequest: { readonly id: string; readonly nonce: number } | null;
  readonly command: { readonly type: 'zoom-in' | 'zoom-out' | 'fit'; readonly nonce: number } | null;
  readonly onNodeSelect: (nodeId: string) => void;
  readonly onGroupToggle: (groupId: string) => void;
}): JSX.Element {
  return (
    <div className="panel h-[720px] overflow-hidden">
      <ReactFlowProvider>
        <GraphCanvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
