import { create } from 'zustand';
import type { Simulation } from '@/types/simulation.types';

interface SimulationState {
  activeSimulation: Simulation | null;
  showBeforeAfter: 'before' | 'after';

  setActiveSimulation: (sim: Simulation | null) => void;
  setShowBeforeAfter: (view: 'before' | 'after') => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  activeSimulation: null,
  showBeforeAfter: 'after',

  setActiveSimulation: (sim) => set({ activeSimulation: sim }),
  setShowBeforeAfter: (view) => set({ showBeforeAfter: view }),
}));
