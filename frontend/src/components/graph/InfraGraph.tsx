import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { applyHierarchicalGrouping, augmentEdgesForGrouping, type GroupZoneData } from '@/lib/graph-grouping';
import { applyLayout, type LayoutType } from '@/lib/graph-layout';
import {
  DISCOVERY_DOMAIN_LABELS,
  buildDiscoveryNodeTooltip,
  getDiscoveryNodeDomain,
  resolveDiscoveryNodeLabels,
  type DiscoveryDomain,
} from '@/lib/discovery-graph';
import {
  computeBlastRadius,
  getEdgeHoverLabel,
  getEdgeStyle,
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
  domainGroupingEnabled?: boolean;
  collapsedDomains?: DiscoveryDomain[];
}

const nodeTypes = {
  infraNode: NodeCard,
  groupZone: GroupZoneNode,
  domainCluster: DomainClusterNode,
};

type FlowBuildResult = {
  nodes: Node[];
  edges: Edge[];
  edgeLookup: Map<string, InfraEdge>;
};

const FIT_OPTIONS = {
  padding: 0.15,
  duration: 300,
  maxZoom: 1.5,
  minZoom: 0.1,
};

interface DomainClusterData {
  label: string;
  domain: DiscoveryDomain;
  memberCount: number;
  spofCount: number;
  avgCriticality: number | null;
  memberIds: string[];
  collapsed: boolean;
}

function GroupZoneNode({ data }: NodeProps) {
  const groupData = (data as unknown as GroupZoneData | undefined) || { label: '', groupType: 'region', memberIds: [] };
  return (
    <div className="h-full w-full px-2 pt-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {groupData.label}
      </span>
    </div>
  );
}

function DomainClusterNode({ data }: NodeProps) {
  const cluster = (data as unknown as DomainClusterData | undefined) || {
    label: 'Cluster',
    domain: 'foundation' as DiscoveryDomain,
    memberCount: 0,
    spofCount: 0,
    avgCriticality: null,
    memberIds: [],
    collapsed: true,
  };
  const avgCriticality =
    typeof cluster.avgCriticality === 'number' && Number.isFinite(cluster.avgCriticality)
      ? Math.round(cluster.avgCriticality)
      : null;

  return (
    <div className="h-full w-full rounded-lg border-2 border-sky-500/50 bg-sky-500/10 px-3 py-2 shadow-sm">
      <p className="truncate text-xs font-semibold uppercase tracking-wide text-sky-700">
        {cluster.label}
      </p>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-sky-900/90">
        <span>{cluster.memberCount} noeuds</span>
        <span>{cluster.spofCount} SPOF</span>
        {avgCriticality != null && <span>Crit {avgCriticality}</span>}
      </div>
      <p className="mt-1 text-[10px] text-sky-900/70">
        Vue pliee du domaine {DISCOVERY_DOMAIN_LABELS[cluster.domain] || cluster.domain}
      </p>
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
  const labels = resolveDiscoveryNodeLabels(node);
  const blastRatio = resolveBlastRatio(node);
  const size = getNodeSize(blastRatio);
  const overrides = getNodeDataOverrides?.(node) || {};
  const customOpacity =
    typeof overrides.customOpacity === 'number' && Number.isFinite(overrides.customOpacity)
      ? overrides.customOpacity
      : undefined;
  const disablePointerEvents = overrides.disablePointerEvents === true;
  const tooltipText = buildDiscoveryNodeTooltip(node);

  return {
    ...((overrides.dimmed || disablePointerEvents) ? { draggable: false, selectable: false } : {}),
    id: node.id,
    type: 'infraNode',
    position: { x: 0, y: 0 },
    style: {
      width: size.width,
      height: size.height,
      zIndex: 10,
      ...(customOpacity != null ? { opacity: customOpacity } : {}),
      ...(disablePointerEvents ? { pointerEvents: 'none' } : {}),
    },
    data: {
      label: labels.shortLabel,
      fullLabel: labels.fullLabel,
      technicalLabel: labels.secondaryLabel || undefined,
      nodeType: node.type,
      nodeTypeLabel: getNodeServiceType(node),
      category: getNodeCategory(node),
      serviceType: getNodeServiceType(node),
      tier: getNodeTier(metadata),
      domain: getDiscoveryNodeDomain(node),
      blastRatio,
      nodeWidth: size.width,
      nodeHeight: size.height,
      metadata,
      provider: node.provider,
      region: node.region,
      isSPOF: node.isSPOF,
      status: statuses?.get(node.id) || 'healthy',
      criticality: node.criticality,
      tooltipText,
      ...overrides,
    } satisfies InfraNodeData,
  };
}

function toEdge(
  edge: InfraEdge,
  getEdgeStyleOverrides?: (edge: InfraEdge) => {
    style?: CSSProperties;
    animated?: boolean;
    type?: Edge['type'];
  },
  weight = 1,
  idOverride?: string,
): Edge {
  const override = getEdgeStyleOverrides?.(edge);
  const baseStyle = getEdgeStyle(edge.type, edge.inferred);
  const baseStrokeWidth = Number(
    (baseStyle as Record<string, unknown> | undefined)?.strokeWidth ?? 1.5,
  );
  const bundledWidth = baseStrokeWidth + Math.min(2.5, Math.log2(weight + 1));

  return {
    ...(override?.animated !== undefined ? { animated: override.animated } : {}),
    id: idOverride || edge.id,
    source: edge.source,
    target: edge.target,
    type: override?.type || 'smoothstep',
    data: {
      edgeType: edge.type,
      inferred: edge.inferred,
      confidence: edge.confidence,
      weight,
      bundled: weight > 1,
    },
    style: {
      ...baseStyle,
      strokeWidth: bundledWidth,
      opacity: Math.min(1, Number(baseStyle.opacity ?? 0.75) + Math.min(0.25, (weight - 1) * 0.06)),
      ...(override?.style || {}),
    },
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
  collapsedDomains?: Set<DiscoveryDomain>,
): FlowBuildResult {
  const collapsed = collapsedDomains && collapsedDomains.size > 0 ? collapsedDomains : null;
  const edgeLookup = new Map<string, InfraEdge>();

  if (!collapsed) {
    const nodes = infraNodes.map((node) => toFlowNode(node, statuses, getNodeDataOverrides));
    const edges: Edge[] = infraEdges.map((edge) => {
      edgeLookup.set(edge.id, edge);
      return toEdge(edge, getEdgeStyleOverrides);
    });
    return { nodes, edges, edgeLookup };
  }

  const representatives = new Map<string, string>();
  const collapsedMembers = new Map<DiscoveryDomain, InfraNode[]>();
  const visibleNodes: Node[] = [];

  infraNodes.forEach((node) => {
    const domain = getDiscoveryNodeDomain(node);
    if (collapsed.has(domain)) {
      const group = collapsedMembers.get(domain) || [];
      group.push(node);
      collapsedMembers.set(domain, group);
      representatives.set(node.id, `cluster:${domain}`);
      return;
    }

    representatives.set(node.id, node.id);
    visibleNodes.push(toFlowNode(node, statuses, getNodeDataOverrides));
  });

  for (const [domain, members] of collapsedMembers.entries()) {
    if (members.length === 0) continue;

    const criticalities = members
      .map((node) => Number(node.criticality))
      .filter((value) => Number.isFinite(value));
    const avgCriticality =
      criticalities.length > 0
        ? criticalities.reduce((sum, value) => sum + value, 0) / criticalities.length
        : null;
    const spofCount = members.filter((node) => node.isSPOF).length;

    visibleNodes.push({
      id: `cluster:${domain}`,
      type: 'domainCluster',
      position: { x: 0, y: 0 },
      data: {
        label: `${DISCOVERY_DOMAIN_LABELS[domain] || domain} (${members.length})`,
        domain,
        memberCount: members.length,
        spofCount,
        avgCriticality,
        memberIds: members.map((member) => member.id),
        collapsed: true,
      } satisfies DomainClusterData,
      style: {
        width: 230,
        height: 86,
        zIndex: 8,
      },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
    } satisfies Node);
  }

  const bundled = new Map<string, { source: string; target: string; edges: InfraEdge[] }>();

  infraEdges.forEach((edge) => {
    const source = representatives.get(edge.source) || edge.source;
    const target = representatives.get(edge.target) || edge.target;
    if (source === target) return;

    const key = `${source}->${target}`;
    const bucket = bundled.get(key);
    if (bucket) {
      bucket.edges.push(edge);
      return;
    }
    bundled.set(key, {
      source,
      target,
      edges: [edge],
    });
  });

  const edges: Edge[] = [];

  for (const bucket of bundled.values()) {
    const sample = bucket.edges[0];
    if (!sample) continue;
    const weight = bucket.edges.length;
    const id = weight === 1 ? sample.id : `bundle:${bucket.source}:${bucket.target}:${weight}`;

    const projected: InfraEdge = {
      ...sample,
      id,
      source: bucket.source,
      target: bucket.target,
    };
    edgeLookup.set(id, sample);
    edges.push(toEdge(projected, getEdgeStyleOverrides, weight, id));
  }

  return {
    nodes: visibleNodes,
    edges,
    edgeLookup,
  };
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
  domainGroupingEnabled = false,
  collapsedDomains = [],
}: InfraGraphProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [layoutedNodes, setLayoutedNodes] = useState<Node[]>([]);
  const [appliedLayoutSignature, setAppliedLayoutSignature] = useState('');
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<Node, Edge> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitTimeoutRef = useRef<number | null>(null);
  const lastZoomRef = useRef(1);

  const infraNodeMap = useMemo(
    () => new Map(infraNodes.map((node) => [node.id, node])),
    [infraNodes],
  );
  const collapsedDomainSet = useMemo(
    () => new Set(domainGroupingEnabled ? collapsedDomains : []),
    [collapsedDomains, domainGroupingEnabled],
  );

  const baseFlow = useMemo<FlowBuildResult>(
    () =>
      buildFlow(
        infraNodes,
        infraEdges,
        nodeStatuses,
        getNodeDataOverrides,
        getEdgeStyleOverrides,
        collapsedDomainSet,
      ),
    [
      infraNodes,
      infraEdges,
      nodeStatuses,
      getNodeDataOverrides,
      getEdgeStyleOverrides,
      collapsedDomainSet,
    ],
  );

  const layoutEdges = useMemo(
    () => (enableNetworkGrouping ? augmentEdgesForGrouping(baseFlow.nodes, baseFlow.edges) : baseFlow.edges),
    [enableNetworkGrouping, baseFlow.nodes, baseFlow.edges],
  );

  const layoutSignature = useMemo(
    () =>
      [
        layoutType,
        enableNetworkGrouping ? '1' : '0',
        baseFlow.nodes.map((node) => node.id).join('|'),
        layoutEdges.map((edge) => `${edge.source}->${edge.target}`).join('|'),
      ].join('::'),
    [layoutType, enableNetworkGrouping, baseFlow.nodes, layoutEdges],
  );

  useEffect(() => {
    let cancelled = false;

    const frame = window.requestAnimationFrame(() => {
      const layouted = applyLayout(baseFlow.nodes, layoutEdges, layoutType, {
        direction: 'LR',
        nodeSpacing: 70,
        rankSpacing: 130,
      });
      const grouped = enableNetworkGrouping ? applyHierarchicalGrouping(layouted.nodes) : layouted.nodes;
      if (cancelled) return;
      setLayoutedNodes(grouped);
      setAppliedLayoutSignature(layoutSignature);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [layoutSignature, baseFlow.nodes, layoutEdges, layoutType, enableNetworkGrouping]);

  const positionedNodes = layoutedNodes.length > 0 ? layoutedNodes : baseFlow.nodes;
  const isLargeGraph = baseFlow.nodes.length + baseFlow.edges.length > 220;
  const isLayoutBusy = isLargeGraph && appliedLayoutSignature !== layoutSignature;

  const highlight = useMemo(() => {
    if (!enableDependencyHighlight || !hoveredNodeId) return null;
    return computeBlastRadius(hoveredNodeId, infraEdges);
  }, [enableDependencyHighlight, hoveredNodeId, infraEdges]);

  const nodesForRender = useMemo(() => {
    if (!highlight) return positionedNodes;

    return positionedNodes.map((node) => {
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

      if (node.type === 'domainCluster') {
        const data = (node.data as unknown as DomainClusterData | undefined) || undefined;
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
  }, [highlight, positionedNodes]);

  const edgesForRender = useMemo(() => {
    const zoomOpacityFactor = zoomLevel < 0.35 ? 0.4 : zoomLevel < 0.6 ? 0.65 : 1;

    return baseFlow.edges.map((edge) => {
      const data = (edge.data as Record<string, unknown> | undefined) || {};
      const weight = Math.max(1, Number(data.weight ?? 1));
      const bundled = data.bundled === true;
      const highlighted = highlight ? highlight.edgeIds.has(String(edge.id)) : true;
      const isHovered = hoveredEdgeId === edge.id;
      const hiddenByZoom = zoomLevel < 0.2 && weight < 4;
      const baseStrokeWidth = Number((edge.style as Record<string, unknown> | undefined)?.strokeWidth ?? 1.5);
      const targetStrokeWidth = highlighted
        ? Math.max(1.4, baseStrokeWidth)
        : Math.max(1, baseStrokeWidth - 0.8);
      const hoverLabel = getEdgeHoverLabel(
        (data.edgeType as string | undefined) || 'dependency',
      );

      return {
        ...edge,
        hidden: hiddenByZoom,
        label: isHovered && zoomLevel >= 0.35
          ? `${hoverLabel}${bundled ? ` x${weight}` : ''}`
          : undefined,
        labelStyle: isHovered ? { fontSize: 10, fontWeight: 600 } : edge.labelStyle,
        style: {
          ...(edge.style || {}),
          opacity: hiddenByZoom
            ? 0
            : highlighted
              ? Number(edge.style?.opacity ?? 1) * zoomOpacityFactor
              : 0.12 * zoomOpacityFactor,
          strokeWidth: targetStrokeWidth,
        },
      };
    });
  }, [highlight, hoveredEdgeId, baseFlow.edges, zoomLevel]);

  const fitToView = useCallback(() => {
    if (!reactFlowInstance || positionedNodes.length === 0) return;
    if (fitTimeoutRef.current !== null) {
      window.clearTimeout(fitTimeoutRef.current);
    }
    fitTimeoutRef.current = window.setTimeout(() => {
      reactFlowInstance.fitView(FIT_OPTIONS);
    }, 100);
  }, [reactFlowInstance, positionedNodes.length]);

  useEffect(() => {
    fitToView();
  }, [
    fitToView,
    layoutType,
    graphViewMode,
    fitViewNonce,
    positionedNodes,
    edgesForRender,
    enableNetworkGrouping,
    domainGroupingEnabled,
    collapsedDomains,
  ]);

  useEffect(
    () => () => {
      if (fitTimeoutRef.current !== null) {
        window.clearTimeout(fitTimeoutRef.current);
      }
    },
    [],
  );

  const handleMove = useCallback((_: MouseEvent | TouchEvent | null, viewport: { zoom: number }) => {
    const nextZoom = Number(viewport.zoom ?? 1);
    if (Math.abs(nextZoom - lastZoomRef.current) < 0.04) return;
    lastZoomRef.current = nextZoom;
    setZoomLevel(nextZoom);
  }, []);

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
      const infra = baseFlow.edgeLookup.get(String(edge.id));
      if (infra && onEdgeClick) onEdgeClick(infra);
    },
    [baseFlow.edgeLookup, onEdgeClick],
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
    <div ref={containerRef} className="relative h-full w-full">
      {isLayoutBusy && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-md border bg-background/90 px-3 py-1 text-xs shadow-sm backdrop-blur">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Calcul du layout...
          </div>
        </div>
      )}
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
        onMove={handleMove}
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
