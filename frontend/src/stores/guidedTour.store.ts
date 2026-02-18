import { create } from 'zustand';

interface GuidedTourOpenRequest {
  pathname: string;
  nonce: number;
}

interface GuidedTourState {
  openRequest: GuidedTourOpenRequest | null;
  requestOpenForPath: (pathname: string) => void;
}

export const useGuidedTourStore = create<GuidedTourState>((set) => ({
  openRequest: null,
  requestOpenForPath: (pathname: string) =>
    set((state) => ({
      openRequest: {
        pathname,
        nonce: (state.openRequest?.nonce ?? 0) + 1,
      },
    })),
}));
