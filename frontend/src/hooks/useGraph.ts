import { useQuery } from '@tanstack/react-query';
import { useGraphStore } from '@/stores/graph.store';
import { discoveryApi } from '@/api/discovery.api';
import { useMemo } from 'react';
import { getCredentialScopeKey } from '@/lib/credentialStorage';

export function useGraph() {
  const { nodes, edges, filters, setGraphData } = useGraphStore();
  const tenantScope = getCredentialScopeKey();

  const query = useQuery({
    queryKey: ['graph', tenantScope],
    queryFn: async () => {
      const { data } = await discoveryApi.getGraph();
      setGraphData(data.nodes, data.edges);
      return data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (filters.types.length > 0 && !filters.types.includes(node.type)) return false;
      if (filters.providers.length > 0 && node.provider && !filters.providers.includes(node.provider)) return false;
      if (filters.regions.length > 0 && node.region && !filters.regions.includes(node.region)) return false;
      if (filters.search) {
        const search = filters.search.toLowerCase();
        return (
          node.name.toLowerCase().includes(search) ||
          node.displayName?.toLowerCase().includes(search) ||
          node.technicalName?.toLowerCase().includes(search) ||
          node.id.toLowerCase().includes(search)
        );
      }
      return true;
    });
  }, [nodes, filters]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    return edges.filter(
      (edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
    );
  }, [edges, filteredNodeIds]);

  const availableTypes = useMemo(() => [...new Set(nodes.map((n) => n.type))], [nodes]);
  const availableProviders = useMemo(() => [...new Set(nodes.map((n) => n.provider).filter(Boolean) as string[])], [nodes]);
  const availableRegions = useMemo(() => [...new Set(nodes.map((n) => n.region).filter(Boolean) as string[])], [nodes]);

  return {
    ...query,
    nodes: filteredNodes,
    edges: filteredEdges,
    allNodes: nodes,
    allEdges: edges,
    availableTypes,
    availableProviders,
    availableRegions,
  };
}
