import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import cytoscape, { type Core, type ElementDefinition, type EventObject } from 'cytoscape';
import cytoscapeDagre from 'cytoscape-dagre';
import type { CSSProperties } from 'react';

import type { LayoutType } from '@/lib/graph-layout';
import {
  CATEGORY_COLORS,
  computeBlastRadius,
  getEdgeHoverLabel,
  getEdgeStyle,
  getNodeCategory,
  getNodeServiceType,
  getNodeTier,
  type GraphCategory,
} from '@/lib/graph-visuals';
import {
  DISCOVERY_DOMAIN_LABELS,
  buildDiscoveryNodeTooltip,
  getDiscoveryNodeDomain,
  type DiscoveryDomain,
  resolveDiscoveryNodeLabels,
} from '@/lib/discovery-graph';
import { DISCOVERY_GRAPH_CONFIG } from '@/config/discoveryGraph';
import type { InfraEdge, InfraNode, NodeStatus } from '@/types/graph.types';
import type { InfraNodeData } from './NodeCard';

let cytoscapePluginRegistered = false;

function ensureCytoscapePluginRegistration(): void {
  if (cytoscapePluginRegistered) return;
  cytoscape.use(cytoscapeDagre);
  cytoscapePluginRegistered = true;
}

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
    type?: string;
  };
  graphViewMode?: GraphViewMode;
  showMiniMap?: boolean;
  fitViewNonce?: number;
  enableDependencyHighlight?: boolean;
  enableNetworkGrouping?: boolean;
  domainGroupingEnabled?: boolean;
  collapsedDomains?: DiscoveryDomain[];
}

interface TooltipState {
  x: number;
  y: number;
  text: string;
}

interface VisibleNodeModel {
  id: string;
  kind: 'infra' | 'cluster';
  category: GraphCategory;
  labelTiny: string;
  labelCompact: string;
  labelFull: string;
  tooltip: string;
  domain: DiscoveryDomain;
  borderColor: string;
  bgColor: string;
  textColor: string;
  opacity: number;
  width: number;
  height: number;
}

interface VisibleEdgeModel {
  id: string;
  source: string;
  target: string;
  edgeType: string;
  inferred: boolean;
  confidence?: number;
  weight: number;
  stroke: string;
  width: number;
  opacity: number;
  lineStyle: 'solid' | 'dashed';
}

interface VisibleGraphModel {
  nodes: VisibleNodeModel[];
  edges: VisibleEdgeModel[];
  nodeLookup: Map<string, InfraNode>;
  edgeLookup: Map<string, InfraEdge>;
  adjacency: Array<{ id: string; source: string; target: string }>;
}

const CLUSTER_PALETTE: Record<DiscoveryDomain, { bg: string; border: string; text: string }> = {
  foundation: { bg: 'rgba(34, 197, 94, 0.12)', border: '#16a34a', text: '#14532d' },
  platform: { bg: 'rgba(56, 189, 248, 0.12)', border: '#0284c7', text: '#0c4a6e' },
  application: { bg: 'rgba(249, 115, 22, 0.12)', border: '#ea580c', text: '#7c2d12' },
  network: { bg: 'rgba(168, 85, 247, 0.12)', border: '#9333ea', text: '#581c87' },
};

const ZOOM_BUCKETS = {
  tiny: 0.33,
  compact: 0.72,
};

const CYTOSCAPE_STYLE: Array<{ selector: string; style: Record<string, unknown> }> = [
  {
    selector: 'node',
    style: {
      label: 'data(displayLabel)',
      color: 'data(textColor)',
      'font-size': 11,
      'text-wrap': 'ellipsis',
      'text-max-width': 190,
      'text-valign': 'center',
      'text-halign': 'center',
      'border-width': 2,
      'border-color': 'data(borderColor)',
      'background-color': 'data(bgColor)',
      opacity: 'data(opacity)',
      shape: 'round-rectangle',
      width: 'data(width)',
      height: 'data(height)',
      padding: '5px',
    },
  },
  {
    selector: 'node[kind = "cluster"]',
    style: {
      'border-style': 'dashed',
      'font-size': 10,
      'font-weight': 700,
      'text-max-width': 210,
      padding: '8px',
    },
  },
  {
    selector: 'edge',
    style: {
      width: 'data(width)',
      opacity: 'data(opacity)',
      'line-color': 'data(stroke)',
      'target-arrow-color': 'data(stroke)',
      'target-arrow-shape': 'triangle',
      'curve-style': 'taxi',
      'taxi-direction': 'horizontal',
      'taxi-turn': 30,
      'line-style': 'data(lineStyle)',
      'arrow-scale': 0.9,
      label: 'data(hoverLabel)',
      color: '#334155',
      'font-size': 10,
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.75,
      'text-background-padding': '2px',
    },
  },
  {
    selector: 'node.sh-dim',
    style: {
      opacity: 0.2,
    },
  },
  {
    selector: 'edge.sh-dim',
    style: {
      opacity: 0.1,
    },
  },
  {
    selector: 'node.sh-focus',
    style: {
      'border-width': 3,
      opacity: 1,
    },
  },
  {
    selector: 'edge.sh-focus',
    style: {
      opacity: 1,
    },
  },
];

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toTinyLabel(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return value.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
}

function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0.08, value));
}

function readCssNumber(style: CSSProperties | undefined, key: keyof CSSProperties): number | null {
  if (!style) return null;
  return toNumber(style[key]);
}

function readCssString(style: CSSProperties | undefined, key: keyof CSSProperties): string | null {
  if (!style) return null;
  return toStringValue(style[key]);
}

function buildLayoutConfig(layout: LayoutType): cytoscape.LayoutOptions {
  if (layout === 'force') {
    return {
      name: 'cose',
      nodeRepulsion: 8000,
      idealEdgeLength: 180,
      animate: false,
      fit: true,
      padding: 30,
    };
  }

  if (layout === 'radial') {
    return {
      name: 'concentric',
      animate: false,
      fit: true,
      padding: 30,
      concentric: (node) => Number(node.degree(false)),
      levelWidth: () => 2,
    };
  }

  return {
    name: 'dagre',
    rankDir: 'LR',
    rankSep: 140,
    nodeSep: 55,
    edgeSep: 18,
    animate: false,
    fit: true,
    padding: 36,
    acyclicer: 'greedy',
  } as unknown as cytoscape.LayoutOptions;
}

function buildVisibleGraphModel(
  infraNodes: InfraNode[],
  infraEdges: InfraEdge[],
  nodeStatuses: Map<string, NodeStatus> | undefined,
  getNodeDataOverrides: ((node: InfraNode) => Partial<InfraNodeData>) | undefined,
  getEdgeStyleOverrides: ((edge: InfraEdge) => { style?: CSSProperties; animated?: boolean; type?: string }) | undefined,
  collapsedDomains: Set<DiscoveryDomain>,
  graphViewMode: GraphViewMode,
  enableNetworkGrouping: boolean,
): VisibleGraphModel {
  const nodeLookup = new Map<string, InfraNode>();
  const edgeLookup = new Map<string, InfraEdge>();
  const adjacency: Array<{ id: string; source: string; target: string }> = [];
  const representatives = new Map<string, string>();
  const collapsedMembers = new Map<DiscoveryDomain, InfraNode[]>();
  const visibleNodes: VisibleNodeModel[] = [];
  const baseNodeWidth = graphViewMode === 'detailed' ? 240 : graphViewMode === 'grouped' ? 210 : 220;
  const baseNodeHeight = graphViewMode === 'detailed' ? 76 : 70;

  for (const node of infraNodes) {
    const domain = getDiscoveryNodeDomain(node);
    const clusterId = `cluster:${domain}`;
    if (collapsedDomains.has(domain)) {
      const members = collapsedMembers.get(domain) || [];
      members.push(node);
      collapsedMembers.set(domain, members);
      representatives.set(node.id, clusterId);
      continue;
    }

    representatives.set(node.id, node.id);
    nodeLookup.set(node.id, node);

    const labels = resolveDiscoveryNodeLabels(node);
    const category = getNodeCategory(node);
    const palette = CATEGORY_COLORS[category] || CATEGORY_COLORS.external;
    const overrides = getNodeDataOverrides?.(node) || {};
    const overrideOpacity = typeof overrides.customOpacity === 'number' ? overrides.customOpacity : null;
    const flowColors = Array.isArray(overrides.flowStripeColors)
      ? overrides.flowStripeColors.filter((color): color is string => typeof color === 'string' && color.length > 0)
      : [];
    const borderColor =
      toStringValue(overrides.customBorderColor) ||
      (flowColors.length > 0 ? flowColors[0] : null) ||
      palette.border;
    const status = nodeStatuses?.get(node.id) || 'healthy';
    const metadata = node.metadata && typeof node.metadata === 'object'
      ? (node.metadata as Record<string, unknown>)
      : {};
    const tier = getNodeTier(metadata);
    const serviceType = getNodeServiceType(node);
    const shortWithTier = tier ? `${labels.shortLabel} T${tier}` : labels.shortLabel;
    const fullWithType = `${labels.fullLabel} - ${serviceType}`;
    const statusLabel = status === 'down' ? 'Hors service' : status === 'degraded' ? 'Degrade' : 'Sain';
    const flowTooltip = toStringValue(overrides.flowTooltip);
    const unknownCost = overrides.showUnknownCostIndicator === true ? '\nCout: inconnu' : '';
    const customTooltip = flowTooltip ? `\nFlux: ${flowTooltip}` : '';

    const networkBoost = enableNetworkGrouping && domain === 'network' ? 12 : 0;
    visibleNodes.push({
      id: node.id,
      kind: 'infra',
      category,
      labelTiny: toTinyLabel(labels.shortLabel),
      labelCompact: shortWithTier,
      labelFull: fullWithType,
      tooltip: `${buildDiscoveryNodeTooltip(node)}\nEtat: ${statusLabel}${customTooltip}${unknownCost}`,
      domain,
      borderColor,
      bgColor: palette.bg,
      textColor: palette.text,
      opacity: clampOpacity(overrideOpacity ?? (overrides.dimmed ? 0.38 : 0.98)),
      width: baseNodeWidth + networkBoost,
      height: baseNodeHeight,
    });
  }

  for (const [domain, members] of collapsedMembers.entries()) {
    if (members.length === 0) continue;
    const palette = CLUSTER_PALETTE[domain];
    const spofCount = members.filter((node) => node.isSPOF).length;
    const criticalityValues = members
      .map((node) => toNumber(node.criticality))
      .filter((value): value is number => value != null);
    const averageCriticality =
      criticalityValues.length > 0
        ? Math.round(criticalityValues.reduce((sum, value) => sum + value, 0) / criticalityValues.length)
        : null;

    visibleNodes.push({
      id: `cluster:${domain}`,
      kind: 'cluster',
      category: 'external',
      labelTiny: DISCOVERY_DOMAIN_LABELS[domain].slice(0, 3).toUpperCase(),
      labelCompact: `${DISCOVERY_DOMAIN_LABELS[domain]} (${members.length})`,
      labelFull: `${DISCOVERY_DOMAIN_LABELS[domain]} - ${members.length} ressources`,
      tooltip: [
        `Domaine ${DISCOVERY_DOMAIN_LABELS[domain]}`,
        `Ressources: ${members.length}`,
        `SPOF: ${spofCount}`,
        averageCriticality != null ? `Criticite moyenne: ${averageCriticality}/100` : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
      domain,
      borderColor: palette.border,
      bgColor: palette.bg,
      textColor: palette.text,
      opacity: 0.98,
      width: 250,
      height: 86,
    });
  }

  const bundledEdges = new Map<string, { source: string; target: string; edges: InfraEdge[] }>();
  for (const edge of infraEdges) {
    const source = representatives.get(edge.source) || edge.source;
    const target = representatives.get(edge.target) || edge.target;
    if (source === target) continue;
    const key = `${source}->${target}`;
    const existing = bundledEdges.get(key);
    if (existing) {
      existing.edges.push(edge);
      continue;
    }
    bundledEdges.set(key, { source, target, edges: [edge] });
  }

  const visibleEdges: VisibleEdgeModel[] = [];
  for (const bundle of bundledEdges.values()) {
    const representative = bundle.edges[0];
    if (!representative) continue;

    const baseStyle = getEdgeStyle(representative.type, representative.inferred);
    const override = getEdgeStyleOverrides?.(representative);
    const style = override?.style;
    const dash = readCssString(style, 'strokeDasharray') || toStringValue(baseStyle.strokeDasharray);
    const baseWidth = readCssNumber(style, 'strokeWidth') ?? toNumber(baseStyle.strokeWidth) ?? 1.5;
    const baseOpacity = readCssNumber(style, 'opacity') ?? toNumber(baseStyle.opacity) ?? 0.86;
    const stroke = readCssString(style, 'stroke') || toStringValue(baseStyle.stroke) || '#94a3b8';
    const weight = bundle.edges.length;
    const edgeId = weight === 1 ? representative.id : `bundle:${bundle.source}:${bundle.target}:${weight}`;
    const inferred = bundle.edges.some((current) => current.inferred);
    const width = Math.max(1.2, baseWidth + Math.min(2.6, Math.log2(weight + 1)));
    const opacity = clampOpacity(baseOpacity + Math.min(0.2, (weight - 1) * 0.04));

    edgeLookup.set(edgeId, representative);
    adjacency.push({ id: edgeId, source: bundle.source, target: bundle.target });
    visibleEdges.push({
      id: edgeId,
      source: bundle.source,
      target: bundle.target,
      edgeType: override?.type || representative.type,
      inferred,
      confidence: representative.confidence,
      weight,
      stroke,
      width,
      opacity,
      lineStyle: dash ? 'dashed' : 'solid',
    });
  }

  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    nodeLookup,
    edgeLookup,
    adjacency,
  };
}

function toCytoscapeElements(graph: VisibleGraphModel): ElementDefinition[] {
  const nodeElements: ElementDefinition[] = graph.nodes.map((node) => ({
    group: 'nodes',
    data: {
      id: node.id,
      kind: node.kind,
      category: node.category,
      labelTiny: node.labelTiny,
      labelCompact: node.labelCompact,
      labelFull: node.labelFull,
      displayLabel: node.labelCompact,
      tooltip: node.tooltip,
      domain: node.domain,
      borderColor: node.borderColor,
      bgColor: node.bgColor,
      textColor: node.textColor,
      opacity: node.opacity,
      width: node.width,
      height: node.height,
    },
  }));

  const edgeElements: ElementDefinition[] = graph.edges.map((edge) => ({
    group: 'edges',
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      edgeType: edge.edgeType,
      hoverLabel: '',
      inferred: edge.inferred,
      confidence: edge.confidence,
      weight: edge.weight,
      stroke: edge.stroke,
      width: edge.width,
      opacity: edge.opacity,
      lineStyle: edge.lineStyle,
    },
  }));

  return [...nodeElements, ...edgeElements];
}

function applyZoomLabels(cy: Core, force = false): void {
  const zoom = cy.zoom();
  const nextBucket = zoom < ZOOM_BUCKETS.tiny ? 'tiny' : zoom < ZOOM_BUCKETS.compact ? 'compact' : 'full';
  const currentBucket = cy.scratch('_zoomBucket') as string | undefined;
  if (!force && currentBucket === nextBucket) return;

  cy.scratch('_zoomBucket', nextBucket);
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const kind = String(node.data('kind'));
      if (kind === 'cluster') {
        const clusterLabel = nextBucket === 'tiny' ? String(node.data('labelTiny')) : String(node.data('labelCompact'));
        node.data('displayLabel', clusterLabel);
        return;
      }

      if (nextBucket === 'tiny') {
        node.data('displayLabel', node.data('labelTiny'));
      } else if (nextBucket === 'compact') {
        node.data('displayLabel', node.data('labelCompact'));
      } else {
        node.data('displayLabel', node.data('labelFull'));
      }
    });
  });
}

function clearHighlight(cy: Core): void {
  cy.batch(() => {
    cy.nodes().removeClass('sh-dim sh-focus');
    cy.edges().removeClass('sh-dim sh-focus');
  });
}

function fitAll(cy: Core, duration = 280): void {
  if (cy.elements().length === 0) return;
  cy.animate({
    fit: {
      eles: cy.elements(),
      padding: 36,
    },
    duration,
  });
}

type CytoscapeRendererWithWheelSensitivity = {
  options?: {
    wheelSensitivity?: number;
  };
};

export function syncCytoscapeWheelSensitivity(
  cy: unknown,
  wheelSensitivity: number,
): void {
  if (!cy || !Number.isFinite(wheelSensitivity) || wheelSensitivity <= 0) return;
  const core = cy as { renderer?: () => unknown };
  if (typeof core.renderer !== 'function') return;

  let renderer: CytoscapeRendererWithWheelSensitivity | null = null;
  try {
    renderer = core.renderer() as CytoscapeRendererWithWheelSensitivity | null;
  } catch {
    return;
  }

  if (!renderer?.options) return;
  if (renderer.options.wheelSensitivity === wheelSensitivity) return;
  renderer.options.wheelSensitivity = wheelSensitivity;
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
  const cyContainerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const nodeLookupRef = useRef<Map<string, InfraNode>>(new Map());
  const edgeLookupRef = useRef<Map<string, InfraEdge>>(new Map());
  const adjacencyRef = useRef<Array<{ id: string; source: string; target: string }>>([]);
  const highlightCacheRef = useRef<Map<string, ReturnType<typeof computeBlastRadius>>>(new Map());
  const onNodeClickRef = useRef<InfraGraphProps['onNodeClick']>(onNodeClick);
  const onEdgeClickRef = useRef<InfraGraphProps['onEdgeClick']>(onEdgeClick);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isLayoutRunning, setIsLayoutRunning] = useState(false);
  const [zoomLabel, setZoomLabel] = useState('100%');

  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  useEffect(() => {
    onEdgeClickRef.current = onEdgeClick;
  }, [onEdgeClick]);

  const collapsedDomainSet = useMemo(
    () => new Set(domainGroupingEnabled ? collapsedDomains : []),
    [collapsedDomains, domainGroupingEnabled],
  );

  const visibleGraph = useMemo(
    () =>
      buildVisibleGraphModel(
        infraNodes,
        infraEdges,
        nodeStatuses,
        getNodeDataOverrides,
        getEdgeStyleOverrides,
        collapsedDomainSet,
        graphViewMode,
        enableNetworkGrouping,
      ),
    [
      infraNodes,
      infraEdges,
      nodeStatuses,
      getNodeDataOverrides,
      getEdgeStyleOverrides,
      collapsedDomainSet,
      graphViewMode,
      enableNetworkGrouping,
    ],
  );

  const elements = useMemo(() => toCytoscapeElements(visibleGraph), [visibleGraph]);
  const isLargeGraph = visibleGraph.nodes.length + visibleGraph.edges.length > 220;

  const handleNodeHover = useCallback(
    (event: EventObject) => {
      const cy = cyRef.current;
      if (!cy) return;
      const nodeId = event.target.id();
      const tooltipText = String(event.target.data('tooltip') || '');
      const position = event.renderedPosition;
      if (tooltipText) {
        setTooltip({
          text: tooltipText,
          x: Math.max(8, Math.round(position.x + 14)),
          y: Math.max(8, Math.round(position.y + 12)),
        });
      }

      if (!enableDependencyHighlight) return;
      let highlight = highlightCacheRef.current.get(nodeId);
      if (!highlight) {
        highlight = computeBlastRadius(nodeId, adjacencyRef.current);
        highlightCacheRef.current.set(nodeId, highlight);
      }

      cy.batch(() => {
        cy.nodes().addClass('sh-dim').removeClass('sh-focus');
        cy.edges().addClass('sh-dim').removeClass('sh-focus');
        highlight.nodeIds.forEach((id) => cy.getElementById(id).removeClass('sh-dim').addClass('sh-focus'));
        highlight.edgeIds.forEach((id) => cy.getElementById(id).removeClass('sh-dim').addClass('sh-focus'));
      });
    },
    [enableDependencyHighlight],
  );

  useEffect(() => {
    ensureCytoscapePluginRegistration();
    const container = cyContainerRef.current;
    if (!container || cyRef.current) return;

    const cy = cytoscape({
      container,
      elements: [],
      style: CYTOSCAPE_STYLE as unknown as cytoscape.StylesheetJson,
      wheelSensitivity: DISCOVERY_GRAPH_CONFIG.wheelSensitivity,
      selectionType: 'single',
      maxZoom: DISCOVERY_GRAPH_CONFIG.maxZoom,
      minZoom: DISCOVERY_GRAPH_CONFIG.minZoom,
      hideEdgesOnViewport: false,
      motionBlur: true,
    });
    syncCytoscapeWheelSensitivity(cy, DISCOVERY_GRAPH_CONFIG.wheelSensitivity);

    const handleTapNode = (event: EventObject) => {
      if (String(event.target.data('kind')) !== 'infra') return;
      const infra = nodeLookupRef.current.get(event.target.id());
      if (infra) onNodeClickRef.current?.(infra);
    };

    const handleTapEdge = (event: EventObject) => {
      const infra = edgeLookupRef.current.get(event.target.id());
      if (infra) onEdgeClickRef.current?.(infra);
    };

    const handleNodeMouseMove = (event: EventObject) => {
      const current = String(event.target.data('tooltip') || '');
      if (!current) return;
      setTooltip({
        text: current,
        x: Math.max(8, Math.round(event.renderedPosition.x + 14)),
        y: Math.max(8, Math.round(event.renderedPosition.y + 12)),
      });
    };

    const handleNodeMouseOut = () => {
      setTooltip(null);
      clearHighlight(cy);
    };

    const handleEdgeMouseOver = (event: EventObject) => {
      const edgeType = String(event.target.data('edgeType') || 'dependency');
      const weight = Number(event.target.data('weight') || 1);
      const suffix = weight > 1 ? ` x${weight}` : '';
      event.target.data('hoverLabel', `${getEdgeHoverLabel(edgeType)}${suffix}`);
    };

    const handleEdgeMouseOut = (event: EventObject) => {
      event.target.data('hoverLabel', '');
    };

    const handleViewportChange = () => {
      applyZoomLabels(cy);
      setZoomLabel(`${Math.round(cy.zoom() * 100)}%`);
    };

    cy.on('tap', 'node', handleTapNode);
    cy.on('tap', 'edge', handleTapEdge);
    cy.on('mouseover', 'node', handleNodeHover);
    cy.on('mousemove', 'node', handleNodeMouseMove);
    cy.on('mouseout', 'node', handleNodeMouseOut);
    cy.on('mouseover', 'edge', handleEdgeMouseOver);
    cy.on('mouseout', 'edge', handleEdgeMouseOut);
    cy.on('zoom pan', handleViewportChange);

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [handleNodeHover]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    syncCytoscapeWheelSensitivity(cy, DISCOVERY_GRAPH_CONFIG.wheelSensitivity);

    highlightCacheRef.current.clear();
    nodeLookupRef.current = visibleGraph.nodeLookup;
    edgeLookupRef.current = visibleGraph.edgeLookup;
    adjacencyRef.current = visibleGraph.adjacency;

    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
      clearHighlight(cy);
    });

    applyZoomLabels(cy, true);
    const layout = cy.layout(buildLayoutConfig(layoutType));
    layout.one('layoutstart', () => {
      setIsLayoutRunning(true);
    });
    layout.one('layoutstop', () => {
      setIsLayoutRunning(false);
      fitAll(cy, 220);
    });
    layout.run();

    return () => {
      try {
        layout.stop();
      } catch {
        // layout may already be disposed
      }
    };
  }, [elements, layoutType, visibleGraph]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    fitAll(cy, 220);
  }, [fitViewNonce]);

  return (
    <div className="relative h-full w-full">
      <div ref={cyContainerRef} className="absolute inset-0" />

      {isLayoutRunning && isLargeGraph && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-md border bg-background/90 px-3 py-1 text-xs shadow-sm backdrop-blur">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Calcul du layout Cytoscape...
          </div>
        </div>
      )}

      {tooltip && (
        <div
          className="pointer-events-none absolute z-30 max-w-[300px] rounded-md border bg-background/95 px-2 py-1 text-[11px] shadow"
          style={{ left: tooltip.x, top: tooltip.y, whiteSpace: 'pre-line' }}
        >
          {tooltip.text}
        </div>
      )}

      {showMiniMap && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-20 rounded-md border bg-background/90 px-3 py-2 text-[11px] shadow-sm">
          <p className="font-semibold">Apercu graphe</p>
          <p>{visibleGraph.nodes.length} noeuds</p>
          <p>{visibleGraph.edges.length} dependances</p>
          <p>Zoom {zoomLabel}</p>
        </div>
      )}
    </div>
  );
}

export const InfraGraph = memo(InfraGraphComponent);
