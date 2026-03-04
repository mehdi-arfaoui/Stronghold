import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './useAuth';
import { clearAuthTokens, getAccessToken, getRefreshToken } from '@/lib/authSession';

const { loginUserMock, getMeMock, refreshTokensMock, logoutUserMock, changePasswordMock } = vi.hoisted(() => ({
  loginUserMock: vi.fn(),
  getMeMock: vi.fn(),
  refreshTokensMock: vi.fn(),
  logoutUserMock: vi.fn(),
  changePasswordMock: vi.fn(),
}));

vi.mock('@/api/auth.api', () => ({
  authApi: {
    loginUser: loginUserMock,
    getMe: getMeMock,
    refreshTokens: refreshTokensMock,
    logoutUser: logoutUserMock,
    changePassword: changePasswordMock,
  },
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function AuthProbe() {
  const { user, isAuthenticated, isLoading, login } = useAuth();

  return (
    <div>
      <div data-testid="auth-state">
        {isLoading ? 'loading' : isAuthenticated ? 'authenticated' : 'anonymous'}
      </div>
      <div data-testid="auth-user-email">{user?.email ?? ''}</div>
      <button type="button" onClick={() => void login('admin@stronghold.local', 'super-secret')}>
        trigger-login
      </button>
    </div>
  );
}

function renderWithAuthProvider() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthTokens();
    window.sessionStorage.clear();
  });

  it('persists access and refresh tokens in sessionStorage on login', async () => {
    loginUserMock.mockResolvedValue({
      data: {
        accessToken: 'access-login',
        refreshToken: 'refresh-login',
        user: {
          id: 'user-1',
          tenantId: 'tenant-1',
          email: 'admin@stronghold.local',
          displayName: 'Admin',
          role: 'ADMIN',
          isActive: true,
          lastLoginAt: null,
          createdAt: '2026-03-04T10:00:00.000Z',
          updatedAt: '2026-03-04T10:00:00.000Z',
        },
      },
    });

    const user = userEvent.setup();
    renderWithAuthProvider();

    await waitFor(() => {
      expect(screen.getByTestId('auth-state')).toHaveTextContent('anonymous');
    });

    await user.click(screen.getByRole('button', { name: 'trigger-login' }));

    await waitFor(() => {
      expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated');
    });

    expect(getAccessToken()).toBe('access-login');
    expect(getRefreshToken()).toBe('refresh-login');
    expect(window.sessionStorage.getItem('stronghold_access_token')).toBe('access-login');
    expect(window.sessionStorage.getItem('stronghold_refresh_token')).toBe('refresh-login');
  });

  it('restores the session from sessionStorage on mount when an access token exists', async () => {
    window.sessionStorage.setItem('stronghold_access_token', 'stored-access');
    window.sessionStorage.setItem('stronghold_refresh_token', 'stored-refresh');
    getMeMock.mockResolvedValue({
      data: {
        id: 'user-2',
        tenantId: 'tenant-1',
        email: 'restored@stronghold.local',
        displayName: 'Restored User',
        role: 'ADMIN',
        isActive: true,
        lastLoginAt: null,
        createdAt: '2026-03-04T10:00:00.000Z',
        updatedAt: '2026-03-04T10:00:00.000Z',
      },
    });

    renderWithAuthProvider();

    await waitFor(() => {
      expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated');
    });

    expect(screen.getByTestId('auth-user-email')).toHaveTextContent('restored@stronghold.local');
    expect(getMeMock).toHaveBeenCalledTimes(1);
    expect(refreshTokensMock).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('stored-access');
    expect(getRefreshToken()).toBe('stored-refresh');
  });

  it('uses the persisted refresh token to restore the session when access token is absent', async () => {
    window.sessionStorage.setItem('stronghold_refresh_token', 'stored-refresh');
    getMeMock.mockRejectedValueOnce(new Error('missing access token'));
    getMeMock.mockResolvedValueOnce({
      data: {
        id: 'user-3',
        tenantId: 'tenant-1',
        email: 'refreshed@stronghold.local',
        displayName: 'Refreshed User',
        role: 'ADMIN',
        isActive: true,
        lastLoginAt: null,
        createdAt: '2026-03-04T10:00:00.000Z',
        updatedAt: '2026-03-04T10:00:00.000Z',
      },
    });
    refreshTokensMock.mockResolvedValue({
      data: {
        accessToken: 'access-from-refresh',
        refreshToken: 'refresh-from-refresh',
      },
    });

    renderWithAuthProvider();

    await waitFor(() => {
      expect(screen.getByTestId('auth-state')).toHaveTextContent('authenticated');
    });

    expect(getMeMock).toHaveBeenCalledTimes(2);
    expect(refreshTokensMock).toHaveBeenCalledWith('stored-refresh');
    expect(getAccessToken()).toBe('access-from-refresh');
    expect(getRefreshToken()).toBe('refresh-from-refresh');
    expect(window.sessionStorage.getItem('stronghold_access_token')).toBe('access-from-refresh');
    expect(window.sessionStorage.getItem('stronghold_refresh_token')).toBe('refresh-from-refresh');
  });
});
