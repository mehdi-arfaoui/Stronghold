export const API_KEY_LOCAL_STORAGE_KEY = 'stronghold_api_key';
export const TOKEN_LOCAL_STORAGE_KEY = 'stronghold_token';

const API_KEY_SESSION_STORAGE_KEY = 'stronghold_api_key_session';
const TOKEN_SESSION_STORAGE_KEY = 'stronghold_token_session';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function normalize(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readScopedCredential(localKey: string, sessionKey: string): string | null {
  if (!isBrowser()) return null;

  const fromSession = normalize(window.sessionStorage.getItem(sessionKey));
  if (fromSession) return fromSession;

  const fromLocal = normalize(window.localStorage.getItem(localKey));
  if (fromLocal) {
    window.sessionStorage.setItem(sessionKey, fromLocal);
  }
  return fromLocal;
}

function writeScopedCredential(localKey: string, sessionKey: string, value: string): void {
  if (!isBrowser()) return;
  const normalized = value.trim();
  if (!normalized) return;
  window.localStorage.setItem(localKey, normalized);
  window.sessionStorage.setItem(sessionKey, normalized);
}

function clearScopedCredential(localKey: string, sessionKey: string): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(localKey);
  window.sessionStorage.removeItem(sessionKey);
}

export function getStoredApiKey(): string | null {
  return readScopedCredential(API_KEY_LOCAL_STORAGE_KEY, API_KEY_SESSION_STORAGE_KEY);
}

export function setStoredApiKey(apiKey: string): void {
  writeScopedCredential(API_KEY_LOCAL_STORAGE_KEY, API_KEY_SESSION_STORAGE_KEY, apiKey);
}

export function clearStoredApiKey(): void {
  clearScopedCredential(API_KEY_LOCAL_STORAGE_KEY, API_KEY_SESSION_STORAGE_KEY);
}

export function getStoredToken(): string | null {
  return readScopedCredential(TOKEN_LOCAL_STORAGE_KEY, TOKEN_SESSION_STORAGE_KEY);
}

export function setStoredToken(token: string): void {
  writeScopedCredential(TOKEN_LOCAL_STORAGE_KEY, TOKEN_SESSION_STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  clearScopedCredential(TOKEN_LOCAL_STORAGE_KEY, TOKEN_SESSION_STORAGE_KEY);
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

export function getCredentialScopeKey(): string {
  const apiKey = getStoredApiKey() || '';
  const token = getStoredToken() || '';
  const raw = `${apiKey}|${token}`;
  if (!raw.trim()) return 'scope_anonymous';
  return `scope_${hashString(raw)}`;
}

export function isCredentialStorageKey(key: string | null | undefined): boolean {
  return (
    key === API_KEY_LOCAL_STORAGE_KEY ||
    key === TOKEN_LOCAL_STORAGE_KEY ||
    key === API_KEY_SESSION_STORAGE_KEY ||
    key === TOKEN_SESSION_STORAGE_KEY
  );
}
