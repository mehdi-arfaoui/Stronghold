import { create } from 'zustand';
import { clearStoredToken, getStoredToken, setStoredToken } from '@/lib/credentialStorage';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: getStoredToken(),
  isAuthenticated: !!getStoredToken(),

  login: (token, user) => {
    setStoredToken(token);
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    clearStoredToken();
    set({ token: null, user: null, isAuthenticated: false });
  },

  setUser: (user) => set({ user }),
}));
