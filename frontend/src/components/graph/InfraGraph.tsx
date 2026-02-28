import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  type Node,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CSSProperties } from 'react';

import { NodeCard, type InfraNodeData } from './NodeCard';
import { GraphMinimap } from './GraphMinimap';
import { applyLayout, type LayoutType } from '@/lib/graph-layout';
import {
  computeBlastRadius,
  getEdgeHoverLabel,
  getEdgeStyle,
  getNetworkGroup,
  getNodeCategory,
  getNodeServiceType,
  getNodeSize,
  getNodeTier,
  resolveBlastRatio,
} from '@/lib/graph-visuals';
import type { InfraNode, InfraEdge, NodeStatus } from '@/types/graph.types';

export type GraphViewMode = 'auto' | 'grouped' | 'detailed';

interface InfraGraphProps {
  infraNodes: InfraNode[];
  infraEdges: InfraEdge[];
  onNodeClick?: (node: InfraNode) => void;
  onEdgeClick?: (edge: InfraEdge) => void;
  nodeStatuses?: Map<string, NodeStatus>;
  layout?: LayoutType;
  getNodeDataOverrides?: (node: InfraNode) => Partial<InfraNodeData>;
  getEdgeStyleOverrides?: (edge: InfraEdge) => {
    style?: CSSProperties;
    animated?: boolean;
    type?: Edge['type'];
  };
  graphViewMode?: GraphViewMode;
  showMiniMap?: boolean;
  fitViewNonce?: number;
  enableDependencyHighlight?: boolean;
  enableNetworkGrouping?: boolean;
}

interface GroupZoneData {
  label: string;
  memberIds: string[];
}

const nodeTypes = {
  infraNode: NodeCard,
  groupZone: GroupZoneNode,
};

type FlowBuildResult = {
  nodes: Node[];
  edges: Edge[];
};

const FIT_OPTIONS = {
  padding: 0.15,
  duration: 300,
  maxZoom: 1.5,
  minZoom: 0.1,
};

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getNodeDimensions(node: Node, fallbackWidth = 180, fallbackHeight = 60): { width: number; height: number } {
  const style = node.style as Record<string, unknown> | undefined;
  return {
    width: Math.max(50, toNumber(style?.width) ?? toNumber(node.width) ?? fallbackWidth),
    height: Math.max(35, toNumber(style?.height) ?? toNumber(node.height) ?? fallbackHeight),
  };
}

function GroupZoneNode({ data }: NodeProps) {
  const groupData = (data as unknown as GroupZoneData | undefined) || { label: '', memberIds: [] };
  return (
    <div className="h-full w-full rounded-xl border border-dashed border-slate-400/30 bg-slate-400/5 px-2 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {groupData.label}
      </span>
    </div>
  );
}

function toFlowNode(
  node: InfraNode,
  statuses?: Map<string, NodeStatus>,
  getNodeDataOverrides?: (node: InfraNode) => Partial<InfraNodeData>,
): Node {
  const metadata = node.metadata && typeof node.metadata === 'object'
    ? (node.metadata as Record<string, unknown>)
    : {};
  const blastRatio = resolveBlastRatio(node);
  const size = getNodeSize(blastRatio);
  const overrides = getNodeDataOverrides?.(node) || {};
  const displayName =
    (typeof metadata.displayName === 'string' && metadata.displayName.trim().length > 0
      ? metadata.displayName
      : node.name) || node.id;

  return {
    ...(overrides.dimmed ? { draggable: false } : {}),
    id: node.id,
    type: 'infraNode',
    position: { x: 0, y: 0 },
    style: {
      width: size.width,
      height: size.height,
      zIndex: 10,
    },
    data: {
      label: displayName,
      nodeType: node.type,
      nodeTypeLabel: getNodeServiceType(node),
      category: getNodeCategory(node),
      serviceType: getNodeServiceType(node),
      tier: getNodeTier(metadata),
      blastRatio,
      nodeWidth: size.width,
      nodeHeight: size.height,
      metadata,
      provider: node.provider,
      region: node.region,
      isSPOF: node.isSPOF,
      status: statuses?.get(node.id) || 'healthy',
      criticality: node.criticality,
      ...overrides,
    } satisfies InfraNodeData,
  };
}

function buildFlow(
  infraNodes: InfraNode[],
  infraEdges: InfraEdge[],
  statuses?: Map<string, NodeStatus>,
  getNodeDataOverrides?: (node: InfraNode) => Partial<InfraNodeData>,
  getEdgeStyleOverrides?: (edge: InfraEdge) => {
    style?: CSSProperties;
    animated?: boolean;
    type?: Edge['type'];
  },
): FlowBuildResult {
  const nodes = infraNodes.map((node) => toFlowNode(node, statuses, getNodeDataOverrides));
  const edges: Edge[] = infraEdges.map((edge) => {
    const override = getEdgeStyleOverrides?.(edge);
    return {
      ...(override?.animated !== undefined ? { animated: override.animated } : {}),
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: override?.type || 'smoothstep',
      data: {
        edgeType: edge.type,
        inferred: edge.inferred,
        confidence: edge.confidence,
      },
      style: {
        ...getEdgeStyle(edge.type, edge.inferred),
        ...(override?.style || {}),
      },
    };
  });

  return { nodes, edges };
}

function applyNetworkGrouping(nodes: Node[]): Node[] {
  if (nodes.length <= 30) return nodes;

  const groupMap = new Map<string, { label: string; members: Node[] }>();
  const clonedNodes = nodes.map((node) => ({ ...node }));

  for (const node of clonedNodes) {
    if (node.type !== 'infraNode') continue;
    const data = (node.data as InfraNodeData | undefined) || undefined;
    const group = getNetworkGroup({
      type: data?.nodeType,
      name: data?.label,
      metadata: data?.metadata,
    });
    if (!group) continue;

    const existing = groupMap.get(group.key);
    if (existing) {
      existing.members.push(node);
      continue;
    }
    groupMap.set(group.key, { label: group.label, members: [node] });
  }

  const groupNodes: Node[] = [];
  const padding = 24;
  const topPadding = 26;

  for (const [groupKey, group] of groupMap.entries()) {
    if (group.members.length < 2) continue;
    const groupId = `group:${groupKey}`;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const member of group.members) {
      const size = getNodeDimensions(member);
      minX = Math.min(minX, member.position.x);
      minY = Math.min(minY, member.position.y);
      maxX = Math.max(maxX, member.position.x + size.width);
      maxY = Math.max(maxY, member.position.y + size.height);
    }

    const groupX = minX - padding;
    const groupY = minY - topPadding;
    const groupWidth = maxX - minX + padding * 2;
    const groupHeight = maxY - minY + padding + topPadding;

    groupNodes.push({
      id: groupId,
      type: 'groupZone',
      position: { x: groupX, y: groupY },
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
      data: {
        label: group.label,
        memberIds: group.members.map((member) => member.id),
      } satisfies GroupZoneData,
      style: {
        width: groupWidth,
        height: groupHeight,
        pointerEvents: 'none',
        zIndex: 0,
      },
    });

    for (const member of group.members) {
      member.parentId = groupId;
      member.extent = 'parent';
      member.position = {
        x: member.position.x - groupX,
        y: member.position.y - groupY,
      };
      member.zIndex = 10;
    }
  }

  return [...groupNodes, ...clonedNodes];
}

function InfraGraphComponent({
  infraNodes,
  infraEdges,
  onNodeClick,
  onEdgeClick,
  nodeStatuses,
  layout: layoutType = 'hierarchical',
  getNodeDataOverrides,
  getEdgeStyleOverrides,
  graphViewMode = 'auto',
  showMiniMap = false,
  fitViewNonce = 0,
  enableDependencyHighlight = false,
  enableNetworkGrouping = false,
}: InfraGraphProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<Node, Edge> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitTimeoutRef = useRef<number | null>(null);

  const infraNodeMap = useMemo(
    () => new Map(infraNodes.map((node) => [node.id, node])),
    [infraNodes],
  );
  const infraEdgeMap = useMemo(
    () => new Map(infraEdges.map((edge) => [edge.id, edge])),
    [infraEdges],
  );

  const baseFlow = useMemo<FlowBuildResult>(
    () =>
      buildFlow(
        infraNodes,
        infraEdges,
        nodeStatuses,
        getNodeDataOverrides,
        getEdgeStyleOverrides,
      ),
    [
      infraNodes,
      infraEdges,
      nodeStatuses,
      getNodeDataOverrides,
      getEdgeStyleOverrides,
    ],
  );

  const layoutedFlow = useMemo(
    () => applyLayout(baseFlow.nodes, baseFlow.edges, layoutType),
    [baseFlow.nodes, baseFlow.edges, layoutType],
  );

  const layoutedNodes = useMemo(
    () => (enableNetworkGrouping ? applyNetworkGrouping(layoutedFlow.nodes) : layoutedFlow.nodes),
    [enableNetworkGrouping, layoutedFlow.nodes],
  );

  const highlight = useMemo(() => {
    if (!enableDependencyHighlight || !hoveredNodeId) return null;
    return computeBlastRadius(hoveredNodeId, infraEdges);
  }, [enableDependencyHighlight, hoveredNodeId, infraEdges]);

  const nodesForRender = useMemo(() => {
    if (!highlight) return layoutedNodes;

    return layoutedNodes.map((node) => {
      if (node.type === 'groupZone') {
        const data = node.data as unknown as GroupZoneData | undefined;
        const hasHighlightedChild = (data?.memberIds || []).some((id) => highlight.nodeIds.has(id));
        return {
          ...node,
          style: {
            ...(node.style || {}),
            opacity: hasHighlightedChild ? 1 : 0.2,
          },
        };
      }

      const data = (node.data as InfraNodeData) || ({} as InfraNodeData);
      const isHighlighted = highlight.nodeIds.has(node.id);
      return {
        ...node,
        data: {
          ...data,
          dimmed: data.dimmed || !isHighlighted,
        },
        style: {
          ...(node.style || {}),
          opacity: isHighlighted ? 1 : 0.24,
        },
      };
    });
  }, [highlight, layoutedNodes]);

  const edgesForRender = useMemo(() => {
    return layoutedFlow.edges.map((edge) => {
      const highlighted = highlight ? highlight.edgeIds.has(String(edge.id)) : true;
      const isHovered = hoveredEdgeId === edge.id;
      return {
        ...edge,
        label: isHovered
          ? getEdgeHoverLabel(
              (edge.data as Record<string, unknown> | undefined)?.edgeType as string || 'dependency',
            )
          : undefined,
        labelStyle: isHovered ? { fontSize: 10, fontWeight: 600 } : edge.labelStyle,
        style: {
          ...(edge.style || {}),
          opacity: highlighted ? (edge.style?.opacity ?? 1) : 0.14,
          strokeWidth: highlighted
            ? Math.max(1.8, Number((edge.style as Record<string, unknown> | undefined)?.strokeWidth ?? 1.8))
            : 1,
        },
      };
    });
  }, [highlight, hoveredEdgeId, layoutedFlow.edges]);

  const fitToView = useCallback(() => {
    if (!reactFlowInstance || infraNodes.length === 0) return;
    if (fitTimeoutRef.current !== null) {
      window.clearTimeout(fitTimeoutRef.current);
    }
    fitTimeoutRef.current = window.setTimeout(() => {
      reactFlowInstance.fitView(FIT_OPTIONS);
    }, 100);
  }, [reactFlowInstance, infraNodes.length]);

  useEffect(() => {
    fitToView();
  }, [fitToView, layoutType, graphViewMode, fitViewNonce, infraNodes, infraEdges, enableNetworkGrouping]);

  useEffect(
    () => () => {
      if (fitTimeoutRef.current !== null) {
        window.clearTimeout(fitTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !reactFlowInstance) return;

    let raf = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        reactFlowInstance.fitView({ ...FIT_OPTIONS, duration: 200 });
      });
    });

    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [reactFlowInstance]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type !== 'infraNode') return;
      const infra = infraNodeMap.get(node.id);
      if (infra && onNodeClick) onNodeClick(infra);
    },
    [infraNodeMap, onNodeClick],
  );

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const infra = infraEdgeMap.get(String(edge.id));
      if (infra && onEdgeClick) onEdgeClick(infra);
    },
    [infraEdgeMap, onEdgeClick],
  );

  const handleNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (!enableDependencyHighlight || node.type !== 'infraNode') return;
      setHoveredNodeId(node.id);
    },
    [enableDependencyHighlight],
  );

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  const handleEdgeMouseEnter = useCallback((_: React.MouseEvent, edge: Edge) => {
    setHoveredEdgeId(String(edge.id));
  }, []);

  const handleEdgeMouseLeave = useCallback(() => {
    setHoveredEdgeId(null);
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full">
      <ReactFlow
        nodes={nodesForRender}
        edges={edgesForRender}
        onInit={setReactFlowInstance}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        nodeTypes={nodeTypes}
        minZoom={0.05}
        maxZoom={2}
        className="bg-background"
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          style: { strokeWidth: 1.5 },
        }}
        onlyRenderVisibleElements
        nodesDraggable={false}
        nodesConnectable={false}
        selectionOnDrag={false}
        panOnScrollSpeed={0.5}
        proOptions={{ hideAttribution: true }}
      >
        <Controls className="rounded-lg border bg-card shadow-sm" />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        {showMiniMap && <GraphMinimap />}
      </ReactFlow>
    </div>
  );
}

export const InfraGraph = memo(InfraGraphComponent);
