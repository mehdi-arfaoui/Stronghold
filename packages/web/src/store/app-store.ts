import { create } from 'zustand';

export interface AppState {
  currentScanId: string | null;
  setCurrentScanId: (id: string | null) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

const THEME_STORAGE_KEY = 'stronghold.theme';

function readTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === 'light' ? 'light' : 'dark';
}

export const useAppStore = create<AppState>((set, get) => ({
  currentScanId: null,
  setCurrentScanId: (id) => set({ currentScanId: id }),
  theme: readTheme(),
  toggleTheme: () => {
    const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    }
    set({ theme: nextTheme });
  },
}));
