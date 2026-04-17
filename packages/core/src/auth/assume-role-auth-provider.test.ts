import { STSClient } from '@aws-sdk/client-sts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthProvider } from './auth-provider.js';
import { AssumeRoleAuthProvider } from './assume-role-auth-provider.js';
import { AuthenticationError } from './errors.js';

const ASSUME_ROLE_TARGET = {
  accountId: '123456789012',
  partition: 'aws',
  region: 'eu-west-1',
  hint: {
    kind: 'assume-role',
    roleArn: 'arn:aws:iam::123456789012:role/StrongholdScanner',
    externalId: 'ext-123',
  },
} as const;

function createSourceProvider(getCredentials = vi.fn().mockResolvedValue({
  accessKeyId: 'AKIA_SOURCE',
  secretAccessKey: 'source-secret',
})): AuthProvider {
  return {
    kind: 'profile',
    getCredentials,
    canHandle: vi.fn().mockResolvedValue(true),
    describeAuthMethod: () => 'profile:source',
  };
}

describe('AssumeRoleAuthProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns temporary credentials with expiration when AssumeRole succeeds', async () => {
    vi.spyOn(STSClient.prototype, 'send').mockResolvedValue({
      Credentials: {
        AccessKeyId: 'ASIA_TARGET',
        SecretAccessKey: 'target-secret',
        SessionToken: 'target-token',
        Expiration: new Date('2026-04-16T11:00:00.000Z'),
      },
    });

    const provider = new AssumeRoleAuthProvider({
      sourceProvider: createSourceProvider(),
    });

    await expect(provider.getCredentials(ASSUME_ROLE_TARGET)).resolves.toMatchObject({
      accessKeyId: 'ASIA_TARGET',
      secretAccessKey: 'target-secret',
      sessionToken: 'target-token',
      expiration: new Date('2026-04-16T11:00:00.000Z'),
    });
  });

  it('throws AuthenticationError immediately on AccessDenied without retrying', async () => {
    const send = vi.spyOn(STSClient.prototype, 'send').mockRejectedValue(
      Object.assign(new Error('Access denied'), {
        name: 'AccessDeniedException',
      }),
    );

    const provider = new AssumeRoleAuthProvider({
      sourceProvider: createSourceProvider(),
    });

    await expect(provider.getCredentials(ASSUME_ROLE_TARGET)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries three times on throttling errors before failing', async () => {
    vi.useFakeTimers();
    const send = vi.spyOn(STSClient.prototype, 'send').mockRejectedValue(
      Object.assign(new Error('Slow down'), {
        name: 'ThrottlingException',
      }),
    );

    const provider = new AssumeRoleAuthProvider({
      sourceProvider: createSourceProvider(),
    });

    const expectation = expect(provider.getCredentials(ASSUME_ROLE_TARGET)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    await vi.runAllTimersAsync();

    await expectation;
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('asks the source provider for refreshed credentials when the source token is expired', async () => {
    const getSourceCredentials = vi
      .fn()
      .mockResolvedValueOnce({
        accessKeyId: 'AKIA_OLD',
        secretAccessKey: 'old-secret',
      })
      .mockResolvedValueOnce({
        accessKeyId: 'AKIA_NEW',
        secretAccessKey: 'new-secret',
      });
    const send = vi
      .spyOn(STSClient.prototype, 'send')
      .mockRejectedValueOnce(
        Object.assign(new Error('Expired token'), {
          name: 'ExpiredTokenException',
        }),
      )
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'ASIA_TARGET',
          SecretAccessKey: 'target-secret',
          SessionToken: 'target-token',
          Expiration: new Date('2026-04-16T11:00:00.000Z'),
        },
      });

    const provider = new AssumeRoleAuthProvider({
      sourceProvider: createSourceProvider(getSourceCredentials),
    });

    await expect(provider.getCredentials(ASSUME_ROLE_TARGET)).resolves.toMatchObject({
      accessKeyId: 'ASIA_TARGET',
      sessionToken: 'target-token',
    });
    expect(getSourceCredentials).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
