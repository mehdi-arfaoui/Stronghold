import type { ApiConfig } from "../types";

const CONFIG_STORAGE_KEY = "stronghold_api_config";
const DEFAULT_BACKEND_URL = "http://localhost:3000";

export function sanitizeBackendUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\/$/, "");
}

function loadStoredConfig(): Partial<ApiConfig> {
  if (typeof window === "undefined") return {};

  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ApiConfig>) : {};
  } catch (_err) {
    return {};
  }
}

export function loadApiConfig(): ApiConfig {
  const stored = loadStoredConfig();
  const envBackend =
    (import.meta.env.VITE_API_URL as string | undefined) ||
    (import.meta.env.VITE_BACKEND_URL as string | undefined);
  const envApiKey = import.meta.env.VITE_API_KEY as string | undefined;

  const backendUrl =
    sanitizeBackendUrl(envBackend) ||
    sanitizeBackendUrl(stored.backendUrl) ||
    DEFAULT_BACKEND_URL;

  const apiKey = envApiKey || stored.apiKey || "";

  return { backendUrl, apiKey };
}

export function persistApiConfig(config: ApiConfig) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const { backendUrl, apiKey } = loadApiConfig();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (!backendUrl) {
    throw new Error(
      "Backend URL manquante : définissez VITE_BACKEND_URL ou utilisez la bannière de configuration locale."
    );
  }

  if (!apiKey) {
    throw new Error(
      "API key manquante : définissez VITE_API_KEY ou renseignez-la dans la bannière de configuration en haut de page."
    );
  }

  const res = await fetch(`${backendUrl}${normalizedPath}`, {
    ...options,
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} – ${text}`);
  }
  return res.json();
}

export const DEFAULTS = {
  backendUrl: DEFAULT_BACKEND_URL,
};
