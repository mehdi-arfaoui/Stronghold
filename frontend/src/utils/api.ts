import type { ApiConfig } from "../types";

const CONFIG_STORAGE_KEY = "stronghold_api_config";
const DEFAULT_BACKEND_URL = "http://localhost:4000";

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function assertApiConfig(): ApiConfig {
  const { backendUrl, apiKey } = loadApiConfig();

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

  return { backendUrl, apiKey };
}

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
  const { backendUrl, apiKey } = assertApiConfig();
  const normalizedPath = normalizePath(path);

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

export async function apiFetchFormData(path: string, formData: FormData, options: RequestInit = {}) {
  const { backendUrl, apiKey } = assertApiConfig();
  const normalizedPath = normalizePath(path);

  const res = await fetch(`${backendUrl}${normalizedPath}`, {
    ...options,
    method: options.method || "POST",
    body: formData,
    headers: {
      "x-api-key": apiKey,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} – ${text}`);
  }

  return res.json();
}

export async function apiDownload(
  path: string,
  filename: string,
  responseType: "blob" | "text" | "json" = "blob"
) {
  const { backendUrl, apiKey } = assertApiConfig();
  const normalizedPath = normalizePath(path);

  const res = await fetch(`${backendUrl}${normalizedPath}`, {
    headers: { "x-api-key": apiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed: ${res.status} – ${text}`);
  }

  let blob: Blob;
  if (responseType === "text") {
    const text = await res.text();
    blob = new Blob([text], { type: "text/plain" });
  } else if (responseType === "json") {
    const json = await res.json();
    blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
  } else {
    blob = await res.blob();
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
