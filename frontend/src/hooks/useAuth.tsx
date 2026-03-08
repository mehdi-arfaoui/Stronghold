import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi, type AuthUser } from '@/api/auth.api';
import {
  clearPendingSetupEmail,
  clearAuthTokens,
  configureAuthClientHandlers,
  getAccessToken,
  getRefreshToken,
  setAuthTokens,
} from '@/lib/authSession';
import { isInternalDemoContext } from '@/lib/demoContext';

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const DEMO_AUTH_USER: AuthUser = {
  id: 'demo-user',
  tenantId: 'demo-tenant',
  email: 'demo@stronghold.local',
  displayName: 'Demo User',
  role: 'ANALYST',
  isActive: true,
  lastLoginAt: null,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const demoAuthBypass = isInternalDemoContext();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(demoAuthBypass ? DEMO_AUTH_USER : null);
  const [isLoading, setIsLoading] = useState(!demoAuthBypass);
  const [isAuthenticated, setIsAuthenticated] = useState(demoAuthBypass);

  const clearSession = useEffectEvent(() => {
    clearAuthTokens();
    startTransition(() => {
      if (demoAuthBypass) {
        setUser(DEMO_AUTH_USER);
        setIsAuthenticated(true);
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
    });
  });

  const refreshSession = useEffectEvent(async (loadUser: boolean) => {
    if (demoAuthBypass) {
      return null;
    }

    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      return null;
    }

    try {
      const { data } = await authApi.refreshTokens(refreshToken);
      setAuthTokens(data);

      if (loadUser || !user) {
        const me = (await authApi.getMe()).data;
        startTransition(() => {
          setUser(me);
          setIsAuthenticated(true);
        });
      } else {
        startTransition(() => {
          setIsAuthenticated(true);
        });
      }

      return data.accessToken;
    } catch {
      clearSession();
      return null;
    }
  });

  useEffect(() => {
    if (demoAuthBypass) {
      configureAuthClientHandlers({
        refreshSession: async () => null,
        onAuthFailure: () => {},
      });
      startTransition(() => {
        setUser(DEMO_AUTH_USER);
        setIsAuthenticated(true);
        setIsLoading(false);
      });

      return () => {
        configureAuthClientHandlers({
          refreshSession: async () => null,
          onAuthFailure: () => {},
        });
      };
    }

    configureAuthClientHandlers({
      refreshSession: () => refreshSession(false),
      onAuthFailure: () => {
        clearSession();
        queryClient.clear();
      },
    });

    let isMounted = true;

    void (async () => {
      const accessToken = getAccessToken();
      const refreshToken = getRefreshToken();
      if (!accessToken && !refreshToken) {
        if (isMounted) {
          setIsLoading(false);
        }
        return;
      }

      try {
        const me = (await authApi.getMe()).data;
        if (isMounted) {
          startTransition(() => {
            setUser(me);
            setIsAuthenticated(true);
          });
        }
      } catch {
        if (refreshToken) {
          await refreshSession(true);
        } else {
          clearSession();
          queryClient.clear();
        }
      }

      if (isMounted) {
        setIsLoading(false);
      }
    })();

    return () => {
      isMounted = false;
      configureAuthClientHandlers({
        refreshSession: async () => null,
        onAuthFailure: () => {},
      });
    };
  }, [demoAuthBypass, queryClient]);

  const login = useEffectEvent(async (email: string, password: string) => {
    if (demoAuthBypass) {
      startTransition(() => {
        setUser(DEMO_AUTH_USER);
        setIsAuthenticated(true);
      });
      return;
    }

    const { data } = await authApi.loginUser(email, password);
    setAuthTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    clearPendingSetupEmail();

    startTransition(() => {
      setUser(data.user);
      setIsAuthenticated(true);
    });

    await queryClient.invalidateQueries();
  });

  const logout = useEffectEvent(async () => {
    if (demoAuthBypass) {
      return;
    }

    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) {
        await authApi.logoutUser(refreshToken);
      }
    } catch {
      // Local logout remains the source of truth.
    }

    clearSession();
    queryClient.clear();
  });

  const changePassword = useEffectEvent(async (currentPassword: string, newPassword: string) => {
    if (demoAuthBypass) {
      throw new Error('Changement de mot de passe indisponible en mode demo.');
    }

    await authApi.changePassword(currentPassword, newPassword);
    await logout();
  });

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        login,
        logout,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
