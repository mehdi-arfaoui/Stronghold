import { useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NodeCard } from './NodeCard';
import { InferredEdge, ConfirmedEdge } from './EdgeLabel';
import { GraphMinimap } from './GraphMinimap';
import { applyLayout, type LayoutType } from '@/lib/graph-layout';
import type { InfraNode, InfraEdge, NodeStatus } from '@/types/graph.types';

const nodeTypes = { infraNode: NodeCard };
const edgeTypes = { inferred: InferredEdge, confirmed: ConfirmedEdge };

interface InfraGraphProps {
  infraNodes: InfraNode[];
  infraEdges: InfraEdge[];
  onNodeClick?: (node: InfraNode) => void;
  onEdgeClick?: (edge: InfraEdge) => void;
  nodeStatuses?: Map<string, NodeStatus>;
  layout?: LayoutType;
}

function toFlowNodes(infraNodes: InfraNode[], statuses?: Map<string, NodeStatus>): Node[] {
  return infraNodes.map((n) => ({
    id: n.id,
    type: 'infraNode',
    position: { x: 0, y: 0 },
    data: {
      label: n.name,
      nodeType: n.type,
      provider: n.provider,
      region: n.region,
      isSPOF: n.isSPOF,
      status: statuses?.get(n.id) || 'healthy',
      criticality: n.criticality,
    },
  }));
}

function toFlowEdges(infraEdges: InfraEdge[]): Edge[] {
  return infraEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: e.inferred ? 'inferred' : 'confirmed',
    data: {
      edgeType: e.type,
      inferred: e.inferred,
      confidence: e.confidence,
    },
  }));
}

export function InfraGraph({
  infraNodes,
  infraEdges,
  onNodeClick,
  onEdgeClick,
  nodeStatuses,
  layout: layoutType = 'hierarchical',
}: InfraGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);

  const infraNodeMap = useMemo(
    () => new Map(infraNodes.map((n) => [n.id, n])),
    [infraNodes]
  );
  const infraEdgeMap = useMemo(
    () => new Map(infraEdges.map((e) => [e.id, e])),
    [infraEdges]
  );

  useEffect(() => {
    const flowNodes = toFlowNodes(infraNodes, nodeStatuses);
    const flowEdges = toFlowEdges(infraEdges);
    const { nodes: layouted, edges: layoutedEdges } = applyLayout(flowNodes, flowEdges, layoutType);
    setNodes(layouted);
    setEdges(layoutedEdges);
  }, [infraNodes, infraEdges, layoutType, nodeStatuses, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const infra = infraNodeMap.get(node.id);
      if (infra && onNodeClick) onNodeClick(infra);
    },
    [infraNodeMap, onNodeClick]
  );

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const infra = infraEdgeMap.get(edge.id);
      if (infra && onEdgeClick) onEdgeClick(infra);
    },
    [infraEdgeMap, onEdgeClick]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      className="bg-background"
    >
      <Controls className="rounded-lg border bg-card shadow-sm" />
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <GraphMinimap />
    </ReactFlow>
  );
}
