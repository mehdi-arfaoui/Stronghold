import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const apiKey = import.meta.env.VITE_API_KEY || localStorage.getItem('stronghold_api_key');
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
      localStorage.removeItem('stronghold_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
