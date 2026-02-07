import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

export type LayoutType = 'hierarchical' | 'force' | 'radial';

interface LayoutOptions {
  direction?: 'TB' | 'LR';
  nodeWidth?: number;
  nodeHeight?: number;
}

export function applyHierarchicalLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): { nodes: Node[]; edges: Edge[] } {
  const { direction = 'TB', nodeWidth = 200, nodeHeight = 80 } = options;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 80, nodesep: 50 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    return {
      ...node,
      position: {
        x: dagreNode.x - nodeWidth / 2,
        y: dagreNode.y - nodeHeight / 2,
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
  const spacing = 250;

  const layoutedNodes = nodes.map((node, i) => ({
    ...node,
    position: {
      x: (i % cols) * spacing + Math.random() * 50,
      y: Math.floor(i / cols) * spacing + Math.random() * 50,
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
  switch (layout) {
    case 'hierarchical':
      return applyHierarchicalLayout(nodes, edges, options);
    case 'force':
      return applyForceLayout(nodes, edges);
    case 'radial':
      return applyRadialLayout(nodes, edges);
  }
}
