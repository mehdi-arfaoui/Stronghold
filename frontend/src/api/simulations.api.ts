import { api } from './client';
import type { Simulation, SimulationConfig } from '@/types/simulation.types';

export const simulationsApi = {
  create: (config: SimulationConfig) =>
    api.post<Simulation>('/simulations', config),

  getAll: () =>
    api.get<Simulation[]>('/simulations'),

  getById: (id: string) =>
    api.get<Simulation>(`/simulations/${id}`),

  delete: (id: string) =>
    api.delete(`/simulations/${id}`),
};
