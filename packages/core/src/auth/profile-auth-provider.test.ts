import { STSClient } from '@aws-sdk/client-sts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationError } from './errors.js';
import { ProfileAuthProvider } from './profile-auth-provider.js';

const PROFILE_TARGET = {
  accountId: '123456789012',
  partition: 'aws',
  region: 'eu-west-1',
  hint: {
    kind: 'profile',
    profileName: 'production',
  },
} as const;

describe('ProfileAuthProvider', () => {
  afterEach(() => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_PROFILE;
    vi.restoreAllMocks();
  });

  it('loads credentials from a named profile', async () => {
    const providerFn = vi.fn().mockResolvedValue({
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
    });

    const provider = new ProfileAuthProvider({
      fromIniFactory: vi.fn().mockReturnValue(providerFn as never),
    });

    await expect(provider.getCredentials(PROFILE_TARGET)).resolves.toMatchObject({
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
    });
    expect(provider.describeAuthMethod(PROFILE_TARGET)).toBe('profile:production');
    expect(providerFn).toHaveBeenCalledTimes(1);
  });

  it('passes the selected profile into fromIni', async () => {
    const fromIniFactory = vi.fn().mockReturnValue(
      vi.fn().mockResolvedValue({
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'secret',
      }) as never,
    );

    const provider = new ProfileAuthProvider({
      fromIniFactory,
    });

    await provider.getCredentials(PROFILE_TARGET);

    expect(fromIniFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: 'production',
      }),
    );
  });

  it('throws an AuthenticationError when the profile cannot be loaded', async () => {
    const provider = new ProfileAuthProvider({
      fromIniFactory: vi.fn().mockReturnValue(
        vi.fn().mockRejectedValue(new Error('profile not found')) as never,
      ),
    });

    await expect(provider.getCredentials(PROFILE_TARGET)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it('returns false when the profile resolves to a different AWS account', async () => {
    const provider = new ProfileAuthProvider({
      fromIniFactory: vi.fn().mockReturnValue(
        vi.fn().mockResolvedValue({
          accessKeyId: 'AKIA_TEST',
          secretAccessKey: 'secret',
        }) as never,
      ),
    });
    vi.spyOn(STSClient.prototype, 'send').mockResolvedValue({
      Account: '999988887777',
    });

    await expect(provider.canHandle(PROFILE_TARGET)).resolves.toBe(false);
  });

  it('confirms the account with STS when the profile matches', async () => {
    const provider = new ProfileAuthProvider({
      fromIniFactory: vi.fn().mockReturnValue(
        vi.fn().mockResolvedValue({
          accessKeyId: 'AKIA_TEST',
          secretAccessKey: 'secret',
        }) as never,
      ),
    });
    vi.spyOn(STSClient.prototype, 'send').mockResolvedValue({
      Account: '123456789012',
    });

    await expect(provider.canHandle(PROFILE_TARGET)).resolves.toBe(true);
  });
});
