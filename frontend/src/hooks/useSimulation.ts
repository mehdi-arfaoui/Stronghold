import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { simulationsApi } from '@/api/simulations.api';
import { useSimulationStore } from '@/stores/simulation.store';
import type { SimulationConfig } from '@/types/simulation.types';

export function useSimulation(id?: string) {
  const queryClient = useQueryClient();
  const { setActiveSimulation } = useSimulationStore();

  const simulationQuery = useQuery({
    queryKey: ['simulation', id],
    queryFn: async () => {
      if (!id) return null;
      const { data } = await simulationsApi.getById(id);
      setActiveSimulation(data);
      return data;
    },
    enabled: !!id,
  });

  const simulationsListQuery = useQuery({
    queryKey: ['simulations'],
    queryFn: async () => {
      const { data } = await simulationsApi.getAll();
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (config: SimulationConfig) => simulationsApi.create(config),
    onSuccess: (response) => {
      setActiveSimulation(response.data);
      queryClient.invalidateQueries({ queryKey: ['simulations'] });
    },
  });

  return {
    simulation: simulationQuery.data,
    simulationLoading: simulationQuery.isLoading,
    simulations: simulationsListQuery.data ?? [],
    simulationsLoading: simulationsListQuery.isLoading,
    createSimulation: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
  };
}
