import type { AxiosRequestConfig } from 'axios';
import { api } from './client';

export type UserRole = 'ADMIN' | 'ANALYST' | 'VIEWER';

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface UserListResponse {
  users: AuthUser[];
  count: number;
  maxUsers: number;
}

export interface CreateUserPayload {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
}

export interface UpdateUserPayload {
  displayName?: string;
  role?: UserRole;
  isActive?: boolean;
}

const skipAuthRefreshConfig: AxiosRequestConfig = {
  skipAuthRefresh: true,
};

export const authApi = {
  loginUser: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { email, password }, skipAuthRefreshConfig),
  refreshTokens: (refreshToken: string) =>
    api.post<Pick<LoginResponse, 'accessToken' | 'refreshToken'>>(
      '/auth/refresh',
      { refreshToken },
      skipAuthRefreshConfig
    ),
  logoutUser: (refreshToken: string) =>
    api.post('/auth/logout', { refreshToken }, skipAuthRefreshConfig),
  getMe: () => api.get<AuthUser>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.put('/auth/me/password', { currentPassword, newPassword }),
  getSetupStatus: () => api.get<{ needsSetup: boolean }>('/auth/setup-status', skipAuthRefreshConfig),
  setupAdmin: (email: string, password: string, displayName: string) =>
    api.post<AuthUser>('/auth/setup', { email, password, displayName }, skipAuthRefreshConfig),

  getUsers: () => api.get<UserListResponse>('/users'),
  createUser: (payload: CreateUserPayload) => api.post<AuthUser>('/users', payload),
  updateUser: (id: string, payload: UpdateUserPayload) => api.put<AuthUser>(`/users/${id}`, payload),
  deleteUser: (id: string) => api.delete(`/users/${id}`),
  resetUserPassword: (id: string, newPassword: string) =>
    api.post(`/users/${id}/reset-password`, { newPassword }),
};
