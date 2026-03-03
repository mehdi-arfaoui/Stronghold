import axios from 'axios';
import { clearStoredApiKey, getStoredApiKey } from '@/lib/credentialStorage';
import {
  getAccessToken,
  getAuthClientHandlers,
  getRefreshToken,
} from '@/lib/authSession';

function resolveApiBaseUrl(): string {
  const configuredBaseUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (!configuredBaseUrl) {
    return '/api';
  }

  try {
    const resolved = new URL(configuredBaseUrl, window.location.origin);
    const isSameOrigin = resolved.origin === window.location.origin;

    if (isSameOrigin && !resolved.pathname.startsWith('/api')) {
      return '/api';
    }
  } catch {
    // Keep configured value if URL parsing fails.
  }

  return configuredBaseUrl;
}

export const api = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const fallbackApiKey = (import.meta.env.VITE_API_KEY as string | undefined)?.trim();
  const apiKey = getStoredApiKey() || fallbackApiKey;
  if (apiKey) {
    config.headers['x-api-key'] = apiKey;
  }

  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

let refreshPromise: Promise<string | null> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const hasRefreshToken = Boolean(getRefreshToken());

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.skipAuthRefresh &&
      hasRefreshToken
    ) {
      originalRequest._retry = true;

      try {
        if (!refreshPromise) {
          refreshPromise = getAuthClientHandlers().refreshSession();
        }

        const nextAccessToken = await refreshPromise;
        refreshPromise = null;

        if (nextAccessToken) {
          originalRequest.headers = originalRequest.headers ?? {};
          originalRequest.headers.Authorization = `Bearer ${nextAccessToken}`;
          return api(originalRequest);
        }
      } catch {
        refreshPromise = null;
      }

      getAuthClientHandlers().onAuthFailure();
    }

    if (error.response?.status === 403 && error.response?.data?.error === 'Invalid API key') {
      clearStoredApiKey();
    }

    return Promise.reject(error);
  }
);
