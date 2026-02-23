import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  type Node,
  type Edge,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CSSProperties } from 'react';

import { NodeCard, type InfraNodeData } from './NodeCard';
import { ClusterNodeCard, type ClusterNodeData } from './ClusterNodeCard';
import { InferredEdge, ConfirmedEdge } from './EdgeLabel';
import { GraphMinimap } from './GraphMinimap';
import { applyLayout, type LayoutType } from '@/lib/graph-layout';
import type { InfraNode, InfraEdge, NodeStatus, NodeType } from '@/types/graph.types';

const nodeTypes = { infraNode: NodeCard, clusterNode: ClusterNodeCard };
const edgeTypes = { inferred: InferredEdge, confirmed: ConfirmedEdge };

const CLUSTER_THRESHOLD_DEFAULT = 50;

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
  clusterThreshold?: number;
}

type ClusterBucket = {
  key: string;
  label: string;
  nodes: InfraNode[];
};

type FlowBuildResult = {
  nodes: Node[];
  edges: Edge[];
};

function resolveTypeGroup(nodeType: NodeType): string {
  if (['VM', 'CONTAINER', 'SERVERLESS', 'KUBERNETES_CLUSTER', 'APPLICATION', 'MICROSERVICE', 'PHYSICAL_SERVER'].includes(nodeType)) {
    return 'compute';
  }
  if (['DATABASE', 'CACHE', 'MESSAGE_QUEUE'].includes(nodeType)) {
    return 'data';
  }
  if (['OBJECT_STORAGE', 'CDN'].includes(nodeType)) {
    return 'storage';
  }
  if (['LOAD_BALANCER', 'API_GATEWAY', 'VPC', 'SUBNET', 'DNS', 'FIREWALL', 'REGION', 'AVAILABILITY_ZONE'].includes(nodeType)) {
    return 'network';
  }
  if (['THIRD_PARTY_API', 'SAAS_SERVICE'].includes(nodeType)) {
    return 'external';
  }
  return 'other';
}

function isClusterNodeData(data: unknown): data is ClusterNodeData {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  return (
    typeof record.label === 'string' &&
    typeof record.count === 'number' &&
    typeof record.criticalCount === 'number' &&
    typeof record.hasSpof === 'boolean' &&
    typeof record.groupKey === 'string'
  );
}

function resolveClusterKey(node: InfraNode): { key: string; label: string } {
  const region = typeof node.region === 'string' && node.region.trim().length > 0 ? node.region.trim() : null;
  if (region) {
    return {
      key: `region:${region}`,
      label: region,
    };
  }

  const metadataLayer =
    node.metadata && typeof node.metadata.layer === 'string' && node.metadata.layer.trim().length > 0
      ? String(node.metadata.layer).trim()
      : null;
  if (metadataLayer) {
    return {
      key: `layer:${metadataLayer}`,
      label: metadataLayer,
    };
  }

  const groupedType = resolveTypeGroup(node.type);
  return {
    key: `type:${groupedType}`,
    label: groupedType,
  };
}

function toFlowNode(
  node: InfraNode,
  statuses?: Map<string, NodeStatus>,
  getNodeDataOverrides?: (node: InfraNode) => Partial<InfraNodeData>,
): Node {
  const overrides = getNodeDataOverrides?.(node) || {};
  return {
    ...(overrides.dimmed ? { draggable: false } : {}),
    id: node.id,
    type: 'infraNode',
    position: { x: 0, y: 0 },
    data: {
      label: node.name,
      nodeType: node.type,
      provider: node.provider,
      region: node.region,
      isSPOF: node.isSPOF,
      status: statuses?.get(node.id) || 'healthy',
      criticality: node.criticality,
      ...overrides,
    } satisfies InfraNodeData,
  };
}

function buildDetailedFlow(
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
      type: override?.type || (edge.inferred ? 'inferred' : 'confirmed'),
      data: {
        edgeType: edge.type,
        inferred: edge.inferred,
        confidence: edge.confidence,
      },
      ...(override?.style ? { style: override.style } : {}),
    };
  });

  return { nodes, edges };
}

function buildClusteredFlow(
  infraNodes: InfraNode[],
  infraEdges: InfraEdge[],
  expandedClusters: Set<string>,
  statuses?: Map<string, NodeStatus>,
  getNodeDataOverrides?: (node: InfraNode) => Partial<InfraNodeData>,
  getEdgeStyleOverrides?: (edge: InfraEdge) => {
    style?: CSSProperties;
    animated?: boolean;
    type?: Edge['type'];
  },
): FlowBuildResult {
  const bucketMap = new Map<string, ClusterBucket>();
  for (const node of infraNodes) {
    const cluster = resolveClusterKey(node);
    const existing = bucketMap.get(cluster.key);
    if (existing) {
      existing.nodes.push(node);
      continue;
    }
    bucketMap.set(cluster.key, {
      key: cluster.key,
      label: cluster.label,
      nodes: [node],
    });
  }

  const nodeToVisibleId = new Map<string, string>();
  const nodes: Node[] = [];
  for (const bucket of bucketMap.values()) {
    const clusterNodeId = `cluster:${bucket.key}`;
    const isExpanded = expandedClusters.has(bucket.key);
    if (isExpanded) {
      for (const node of bucket.nodes) {
        nodeToVisibleId.set(node.id, node.id);
        nodes.push(toFlowNode(node, statuses, getNodeDataOverrides));
      }
      continue;
    }

    for (const node of bucket.nodes) {
      nodeToVisibleId.set(node.id, clusterNodeId);
    }
    const criticalCount = bucket.nodes.filter((node) => (node.criticality ?? 0) >= 0.7).length;
    const hasSpof = bucket.nodes.some((node) => Boolean(node.isSPOF));

    nodes.push({
      id: clusterNodeId,
      type: 'clusterNode',
      position: { x: 0, y: 0 },
      data: {
        label: bucket.label,
        count: bucket.nodes.length,
        criticalCount,
        hasSpof,
        groupKey: bucket.key,
      } satisfies ClusterNodeData,
    });
  }

  const edgeAccumulator = new Map<string, {
    source: string;
    target: string;
    inferred: boolean;
    count: number;
    sample: InfraEdge;
    clustered: boolean;
  }>();

  for (const edge of infraEdges) {
    const source = nodeToVisibleId.get(edge.source);
    const target = nodeToVisibleId.get(edge.target);
    if (!source || !target || source === target) continue;
    const inferred = Boolean(edge.inferred);
    const key = `${source}->${target}:${inferred ? 'i' : 'c'}`;
    const existing = edgeAccumulator.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    edgeAccumulator.set(key, {
      source,
      target,
      inferred,
      count: 1,
      sample: edge,
      clustered: source.startsWith('cluster:') || target.startsWith('cluster:'),
    });
  }

  const edges: Edge[] = [];
  for (const entry of edgeAccumulator.values()) {
    const canApplyDirectOverride = !entry.clustered && entry.count === 1;
    const override = canApplyDirectOverride ? getEdgeStyleOverrides?.(entry.sample) : undefined;
    const inferredEdge = entry.inferred;
    const strokeWidth = entry.clustered ? Math.min(5, 1.5 + Math.log2(entry.count + 1)) : undefined;

    edges.push({
      id:
        entry.clustered || entry.count > 1
          ? `cluster-edge:${entry.source}:${entry.target}:${inferredEdge ? 'i' : 'c'}`
          : entry.sample.id,
      source: entry.source,
      target: entry.target,
      type: override?.type || (inferredEdge ? 'inferred' : 'confirmed'),
      ...(override?.animated !== undefined ? { animated: override.animated } : {}),
      data: {
        edgeType: entry.sample.type,
        inferred: entry.sample.inferred,
        confidence: entry.sample.confidence,
        count: entry.count,
      },
      style: {
        ...(override?.style || {}),
        ...(strokeWidth ? { strokeWidth } : {}),
        ...(entry.clustered ? { opacity: 0.8 } : {}),
      },
    });
  }

  return { nodes, edges };
}

export function InfraGraph({
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
  clusterThreshold = CLUSTER_THRESHOLD_DEFAULT,
}: InfraGraphProps) {
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  const infraNodeMap = useMemo(
    () => new Map(infraNodes.map((node) => [node.id, node])),
    [infraNodes],
  );
  const infraEdgeMap = useMemo(
    () => new Map(infraEdges.map((edge) => [edge.id, edge])),
    [infraEdges],
  );

  const clusteringEnabled =
    graphViewMode === 'grouped' ||
    (graphViewMode === 'auto' && infraNodes.length > clusterThreshold);

  const flow = useMemo<FlowBuildResult>(() => {
    if (!clusteringEnabled) {
      return buildDetailedFlow(
        infraNodes,
        infraEdges,
        nodeStatuses,
        getNodeDataOverrides,
        getEdgeStyleOverrides,
      );
    }

    return buildClusteredFlow(
      infraNodes,
      infraEdges,
      expandedClusters,
      nodeStatuses,
      getNodeDataOverrides,
      getEdgeStyleOverrides,
    );
  }, [
    clusteringEnabled,
    expandedClusters,
    infraNodes,
    infraEdges,
    nodeStatuses,
    getNodeDataOverrides,
    getEdgeStyleOverrides,
  ]);

  const layouted = useMemo(
    () => applyLayout(flow.nodes, flow.edges, layoutType),
    [flow.nodes, flow.edges, layoutType],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'clusterNode') {
        const groupKey = isClusterNodeData(node.data) ? node.data.groupKey : null;
        if (!groupKey) return;
        setExpandedClusters((previous) => {
          const next = new Set(previous);
          if (next.has(groupKey)) {
            next.delete(groupKey);
          } else {
            next.add(groupKey);
          }
          return next;
        });
        return;
      }

      const infra = infraNodeMap.get(node.id);
      if (infra && onNodeClick) onNodeClick(infra);
    },
    [infraNodeMap, onNodeClick],
  );

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      if (String(edge.id).startsWith('cluster-edge:')) return;
      const infra = infraEdgeMap.get(edge.id);
      if (infra && onEdgeClick) onEdgeClick(infra);
    },
    [infraEdgeMap, onEdgeClick],
  );

  return (
    <ReactFlow
      nodes={layouted.nodes}
      edges={layouted.edges}
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      className="bg-background"
      defaultEdgeOptions={{
        type: 'smoothstep',
        animated: false,
      }}
      onlyRenderVisibleElements
      nodesDraggable={false}
      selectionOnDrag={false}
      panOnScrollSpeed={0.5}
      proOptions={{ hideAttribution: true }}
    >
      <Controls className="rounded-lg border bg-card shadow-sm" />
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      {showMiniMap && <GraphMinimap />}
    </ReactFlow>
  );
}
