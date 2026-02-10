import { api } from './client';
import type { RecoveryPriority, ScenarioTemplate, Simulation, SimulationConfig } from '@/types/simulation.types';

export const simulationsApi = {
  create: (config: SimulationConfig) =>
    api.post<Simulation>('/simulations', config),

  getAll: () =>
    api.get<Simulation[]>('/simulations'),

  getById: (id: string) =>
    api.get<Simulation>(`/simulations/${id}`),

  getTemplates: () =>
    api.get<{ templates: ScenarioTemplate[] }>('/simulations/templates'),

  getRecoveryPriorities: () =>
    api.get<{ priorities: RecoveryPriority[] }>('/simulations/recovery-priorities'),

  delete: (id: string) =>
    api.delete(`/simulations/${id}`),
};
