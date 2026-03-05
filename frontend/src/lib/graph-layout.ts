import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import { getNodeLayer } from '@/lib/graph-visuals';

export type LayoutType = 'hierarchical' | 'force' | 'radial';

interface LayoutOptions {
  direction?: 'TB' | 'LR';
  nodeWidth?: number;
  nodeHeight?: number;
  nodeSpacing?: number;
  rankSpacing?: number;
}

type LayoutCacheEntry = Map<string, { x: number; y: number }>;

const LAYOUT_CACHE_LIMIT = 30;
const layoutCache = new Map<string, LayoutCacheEntry>();

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function resolveNodeDimensions(node: Node, fallbackWidth: number, fallbackHeight: number): { width: number; height: number } {
  const width = toNumber((node.style as Record<string, unknown> | undefined)?.width) ?? toNumber(node.width) ?? fallbackWidth;
  const height = toNumber((node.style as Record<string, unknown> | undefined)?.height) ?? toNumber(node.height) ?? fallbackHeight;

  return {
    width: Math.max(40, width),
    height: Math.max(28, height),
  };
}

function resolveLayer(node: Node): number {
  const data = (node.data as Record<string, unknown> | undefined) || {};
  const metadata = data.metadata && typeof data.metadata === 'object'
    ? (data.metadata as Record<string, unknown>)
    : undefined;

  return getNodeLayer({
    type: typeof data.nodeType === 'string' ? data.nodeType : node.type,
    name: typeof data.label === 'string' ? data.label : undefined,
    metadata,
  });
}

function buildLayoutKey(nodes: Node[], edges: Edge[], layout: LayoutType, options?: LayoutOptions): string {
  const nodeSignature = [...nodes]
    .map((node) => {
      const style = (node.style as Record<string, unknown> | undefined) || {};
      const width = toNumber(style.width) ?? toNumber(node.width) ?? 'auto';
      const height = toNumber(style.height) ?? toNumber(node.height) ?? 'auto';
      const parent = node.parentId || '';
      return `${node.id}:${width}x${height}:${parent}`;
    })
    .sort()
    .join('|');

  const edgeSignature = [...edges]
    .map((edge) => `${edge.source}->${edge.target}`)
    .sort()
    .join('|');

  const optionsSignature = options
    ? `${options.direction || ''}:${options.nodeWidth || ''}:${options.nodeHeight || ''}:${options.nodeSpacing || ''}:${options.rankSpacing || ''}`
    : '';

  return `${layout}|${optionsSignature}|n:${nodeSignature}|e:${edgeSignature}`;
}

function readFromCache(nodes: Node[], key: string): Node[] | null {
  const cached = layoutCache.get(key);
  if (!cached) return null;

  layoutCache.delete(key);
  layoutCache.set(key, cached);

  return nodes.map((node) => {
    const position = cached.get(node.id);
    if (!position) return node;
    return {
      ...node,
      position: { ...position },
    };
  });
}

function writeToCache(nodes: Node[], key: string): void {
  const entry: LayoutCacheEntry = new Map(
    nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]),
  );
  layoutCache.set(key, entry);
  if (layoutCache.size <= LAYOUT_CACHE_LIMIT) return;

  const oldestKey = layoutCache.keys().next().value;
  if (typeof oldestKey === 'string') {
    layoutCache.delete(oldestKey);
  }
}

export function applyHierarchicalLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): { nodes: Node[]; edges: Edge[] } {
  const {
    direction = 'TB',
    nodeWidth = 180,
    nodeHeight = 60,
    nodeSpacing = 80,
    rankSpacing = 120,
  } = options;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: rankSpacing,
    nodesep: nodeSpacing,
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((node) => {
    const size = resolveNodeDimensions(node, nodeWidth, nodeHeight);
    g.setNode(node.id, {
      width: size.width,
      height: size.height,
      rank: resolveLayer(node),
    });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const size = resolveNodeDimensions(node, nodeWidth, nodeHeight);
    return {
      ...node,
      position: {
        x: dagreNode.x - size.width / 2,
        y: dagreNode.y - size.height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

export function applyForceLayout(
  nodes: Node[],
  edges: Edge[]
): { nodes: Node[]; edges: Edge[] } {
  const nodeCount = nodes.length;
  const cols = Math.ceil(Math.sqrt(nodeCount));
  const spacing = 220;

  const layoutedNodes = nodes.map((node, i) => ({
    ...node,
    position: {
      x: (i % cols) * spacing,
      y: Math.floor(i / cols) * spacing,
    },
  }));

  return { nodes: layoutedNodes, edges };
}

export function applyRadialLayout(
  nodes: Node[],
  edges: Edge[]
): { nodes: Node[]; edges: Edge[] } {
  const center = { x: 500, y: 500 };
  const ringSpacing = 200;

  const edgeCount = new Map<string, number>();
  edges.forEach((edge) => {
    edgeCount.set(edge.source, (edgeCount.get(edge.source) || 0) + 1);
    edgeCount.set(edge.target, (edgeCount.get(edge.target) || 0) + 1);
  });

  const sorted = [...nodes].sort(
    (a, b) => (edgeCount.get(b.id) || 0) - (edgeCount.get(a.id) || 0)
  );

  const layoutedNodes = sorted.map((node, i) => {
    if (i === 0) {
      return { ...node, position: center };
    }
    const ring = Math.ceil(i / 8);
    const posInRing = (i - 1) % 8;
    const totalInRing = Math.min(8, sorted.length - 1 - (ring - 1) * 8);
    const angle = (2 * Math.PI * posInRing) / totalInRing;
    const radius = ring * ringSpacing;

    return {
      ...node,
      position: {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

export function applyLayout(
  nodes: Node[],
  edges: Edge[],
  layout: LayoutType,
  options?: LayoutOptions
): { nodes: Node[]; edges: Edge[] } {
  const key = buildLayoutKey(nodes, edges, layout, options);
  const cachedNodes = readFromCache(nodes, key);
  if (cachedNodes) {
    return { nodes: cachedNodes, edges };
  }

  let result: { nodes: Node[]; edges: Edge[] };
  switch (layout) {
    case 'hierarchical':
      result = applyHierarchicalLayout(nodes, edges, options);
      break;
    case 'force':
      result = applyForceLayout(nodes, edges);
      break;
    case 'radial':
      result = applyRadialLayout(nodes, edges);
      break;
  }

  writeToCache(result.nodes, key);
  return result;
}
