import {
  type AuthProvider,
  type AuthProviderKind,
  type AuthTarget,
} from './auth-provider.js';
import { NoAuthProviderAvailableError } from './errors.js';

export const DEFAULT_DETECTION_ORDER: readonly AuthProviderKind[] = [
  'profile',
  'assume-role',
  'sso',
];

export async function detectAuthProvider(
  target: AuthTarget,
  providers: readonly AuthProvider[],
  order: readonly AuthProviderKind[] = DEFAULT_DETECTION_ORDER,
): Promise<AuthProvider> {
  const byKind = new Map<AuthProviderKind, AuthProvider>();
  for (const provider of providers) {
    if (!byKind.has(provider.kind)) {
      byKind.set(provider.kind, provider);
    }
  }

  const attempted: AuthProviderKind[] = [];
  for (const kind of order) {
    const provider = byKind.get(kind);
    if (!provider) {
      continue;
    }

    attempted.push(kind);
    try {
      if (await provider.canHandle(target)) {
        return provider;
      }
    } catch {
      continue;
    }
  }

  throw new NoAuthProviderAvailableError(target, attempted);
}
