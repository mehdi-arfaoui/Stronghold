import { describe, expect, it, vi } from 'vitest';

import type { AuthProvider } from './auth-provider.js';
import { DEFAULT_DETECTION_ORDER, detectAuthProvider } from './auth-detector.js';
import { NoAuthProviderAvailableError } from './errors.js';

const TEST_TARGET = {
  accountId: '123456789012',
  partition: 'aws',
  region: 'eu-west-1',
} as const;

function createProvider(
  kind: AuthProvider['kind'],
  canHandle: boolean,
): AuthProvider {
  return {
    kind,
    getCredentials: vi.fn(),
    canHandle: vi.fn().mockResolvedValue(canHandle),
    describeAuthMethod: () => kind,
  };
}

describe('detectAuthProvider', () => {
  it('returns the first provider matching the default detection order', async () => {
    const profile = createProvider('profile', true);
    const assumeRole = createProvider('assume-role', true);
    const sso = createProvider('sso', true);

    await expect(
      detectAuthProvider(TEST_TARGET, [assumeRole, sso, profile]),
    ).resolves.toBe(profile);
    expect(DEFAULT_DETECTION_ORDER).toEqual(['profile', 'assume-role', 'sso']);
  });

  it('returns SSO when it is the only provider that can handle the target', async () => {
    const profile = createProvider('profile', false);
    const assumeRole = createProvider('assume-role', false);
    const sso = createProvider('sso', true);

    await expect(
      detectAuthProvider(TEST_TARGET, [profile, assumeRole, sso]),
    ).resolves.toBe(sso);
  });

  it('throws NoAuthProviderAvailableError when no provider matches', async () => {
    const profile = createProvider('profile', false);
    const assumeRole = createProvider('assume-role', false);

    await expect(
      detectAuthProvider(TEST_TARGET, [profile, assumeRole]),
    ).rejects.toBeInstanceOf(NoAuthProviderAvailableError);
  });

  it('respects a custom detection order', async () => {
    const profile = createProvider('profile', true);
    const sso = createProvider('sso', true);

    await expect(
      detectAuthProvider(TEST_TARGET, [profile, sso], ['sso', 'profile']),
    ).resolves.toBe(sso);
  });
});
