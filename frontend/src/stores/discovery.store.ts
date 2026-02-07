import { create } from 'zustand';
import type { ScanJob } from '@/types/discovery.types';

interface DiscoveryState {
  currentJob: ScanJob | null;
  isScanning: boolean;
  configuredProviders: string[];

  setCurrentJob: (job: ScanJob | null) => void;
  setIsScanning: (scanning: boolean) => void;
  setConfiguredProviders: (providers: string[]) => void;
  addConfiguredProvider: (provider: string) => void;
}

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  currentJob: null,
  isScanning: false,
  configuredProviders: [],

  setCurrentJob: (job) => set({ currentJob: job }),
  setIsScanning: (scanning) => set({ isScanning: scanning }),
  setConfiguredProviders: (providers) => set({ configuredProviders: providers }),
  addConfiguredProvider: (provider) =>
    set((state) => ({
      configuredProviders: state.configuredProviders.includes(provider)
        ? state.configuredProviders
        : [...state.configuredProviders, provider],
    })),
}));
