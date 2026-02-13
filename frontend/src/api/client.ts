import axios from 'axios';

function resolveApiBaseUrl(): string {
  const configuredBaseUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (!configuredBaseUrl) {
    return '/api';
  }

  try {
    const resolved = new URL(configuredBaseUrl, window.location.origin);
    const isSameOrigin = resolved.origin === window.location.origin;

    // Prevent misrouting API calls to the SPA root (which returns index.html)
    // when VITE_API_URL is set to something like http://localhost:3000.
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
  const apiKey = localStorage.getItem('stronghold_api_key')?.trim();
  if (apiKey) {
    config.headers['x-api-key'] = apiKey;
  }
  const token = localStorage.getItem('stronghold_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      // Only redirect to login if a JWT session expired (token was present).
      // Don't redirect for missing/invalid API key — let the caller handle the error.
      const hadToken = localStorage.getItem('stronghold_token');
      if (hadToken) {
        localStorage.removeItem('stronghold_token');
        window.location.href = '/login';
      }
    }

    if (err.response?.status === 403 && err.response?.data?.error === 'Invalid API key') {
      localStorage.removeItem('stronghold_api_key');
    }

    return Promise.reject(err);
  }
);
