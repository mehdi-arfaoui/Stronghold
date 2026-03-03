const REFRESH_TOKEN_SESSION_KEY = 'stronghold_refresh_token';
const PENDING_SETUP_EMAIL_SESSION_KEY = 'stronghold_pending_setup_email';

let accessToken: string | null = null;

type AuthClientHandlers = {
  refreshSession: () => Promise<string | null>;
  onAuthFailure: () => void;
};

let authClientHandlers: AuthClientHandlers = {
  refreshSession: async () => null,
  onAuthFailure: () => {},
};

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function normalize(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function configureAuthClientHandlers(nextHandlers: Partial<AuthClientHandlers>): void {
  authClientHandlers = {
    ...authClientHandlers,
    ...nextHandlers,
  };
}

export function getAuthClientHandlers(): AuthClientHandlers {
  return authClientHandlers;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  if (!isBrowser()) return null;
  return normalize(window.sessionStorage.getItem(REFRESH_TOKEN_SESSION_KEY));
}

export function setAccessToken(nextAccessToken: string | null): void {
  accessToken = normalize(nextAccessToken);
}

export function setRefreshToken(nextRefreshToken: string | null): void {
  if (!isBrowser()) return;
  const normalized = normalize(nextRefreshToken);
  if (!normalized) {
    window.sessionStorage.removeItem(REFRESH_TOKEN_SESSION_KEY);
    return;
  }
  window.sessionStorage.setItem(REFRESH_TOKEN_SESSION_KEY, normalized);
}

export function setAuthTokens(tokens: {
  accessToken: string;
  refreshToken: string;
}): void {
  setAccessToken(tokens.accessToken);
  setRefreshToken(tokens.refreshToken);
}

export function clearAuthTokens(): void {
  accessToken = null;
  if (!isBrowser()) return;
  window.sessionStorage.removeItem(REFRESH_TOKEN_SESSION_KEY);
}

export function getPendingSetupEmail(): string | null {
  if (!isBrowser()) return null;
  return normalize(window.sessionStorage.getItem(PENDING_SETUP_EMAIL_SESSION_KEY));
}

export function setPendingSetupEmail(email: string | null): void {
  if (!isBrowser()) return;
  const normalized = normalize(email);
  if (!normalized) {
    window.sessionStorage.removeItem(PENDING_SETUP_EMAIL_SESSION_KEY);
    return;
  }
  window.sessionStorage.setItem(PENDING_SETUP_EMAIL_SESSION_KEY, normalized);
}

export function clearPendingSetupEmail(): void {
  if (!isBrowser()) return;
  window.sessionStorage.removeItem(PENDING_SETUP_EMAIL_SESSION_KEY);
}
