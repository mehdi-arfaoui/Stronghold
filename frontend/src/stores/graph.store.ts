import { create } from 'zustand';
import type { InfraNode, InfraEdge, NodeStatus } from '@/types/graph.types';
import type { LayoutType } from '@/lib/graph-layout';
import type { CriticalityFilter, DiscoveryDomain } from '@/lib/discovery-graph';

interface GraphFilters {
  types: string[];
  providers: string[];
  regions: string[];
  tiers: number[];
  domains: DiscoveryDomain[];
  criticality: CriticalityFilter;
  search: string;
}

interface GraphState {
  nodes: InfraNode[];
  edges: InfraEdge[];
  selectedNodeId: string | null;
  layout: LayoutType;
  filters: GraphFilters;
  nodeStatuses: Map<string, NodeStatus>;

  setGraphData: (nodes: InfraNode[], edges: InfraEdge[]) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setLayout: (layout: LayoutType) => void;
  setFilters: (filters: Partial<GraphFilters>) => void;
  setNodeStatuses: (statuses: Map<string, NodeStatus>) => void;
  clearNodeStatuses: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  layout: 'hierarchical',
  filters: {
    types: [],
    providers: [],
    regions: [],
    tiers: [],
    domains: [],
    criticality: 'all',
    search: '',
  },
  nodeStatuses: new Map(),

  setGraphData: (nodes, edges) => set({ nodes, edges }),
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setLayout: (layout) => set({ layout }),
  setFilters: (filters) =>
    set((state) => ({
      filters: { ...state.filters, ...filters },
    })),
  setNodeStatuses: (statuses) => set({ nodeStatuses: statuses }),
  clearNodeStatuses: () => set({ nodeStatuses: new Map() }),
}));
