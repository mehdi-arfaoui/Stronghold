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

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const clearSession = useEffectEvent(() => {
    clearAuthTokens();
    startTransition(() => {
      setUser(null);
      setIsAuthenticated(false);
    });
  });

  const refreshSession = useEffectEvent(async (loadUser: boolean) => {
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
  }, [queryClient]);

  const login = useEffectEvent(async (email: string, password: string) => {
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
