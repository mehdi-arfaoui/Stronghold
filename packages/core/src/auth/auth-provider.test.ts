import { describe, expect, it, vi } from 'vitest';

import {
  getAuthTargetCacheKey,
  type AuthProvider,
  type AuthTarget,
} from './auth-provider.js';

describe('auth-provider', () => {
  it('builds stable cache keys for equivalent auth hints', () => {
    const left: AuthTarget = {
      accountId: '123456789012',
      partition: 'aws',
      region: 'eu-west-1',
      hint: {
        kind: 'assume-role',
        roleArn: 'arn:aws:iam::123456789012:role/StrongholdScanner',
        externalId: 'ext-123',
      },
    };
    const right: AuthTarget = {
      accountId: '123456789012',
      partition: 'aws',
      region: 'eu-west-1',
      hint: {
        externalId: 'ext-123',
        roleArn: 'arn:aws:iam::123456789012:role/StrongholdScanner',
        kind: 'assume-role',
      },
    };

    expect(getAuthTargetCacheKey(left)).toBe(getAuthTargetCacheKey(right));
  });

  it('differentiates cache keys when assume-role targets differ', () => {
    expect(
      getAuthTargetCacheKey({
        accountId: '123456789012',
        partition: 'aws',
        region: 'eu-west-1',
        hint: {
          kind: 'assume-role',
          roleArn: 'arn:aws:iam::123456789012:role/ScannerA',
        },
      }),
    ).not.toBe(
      getAuthTargetCacheKey({
        accountId: '123456789012',
        partition: 'aws',
        region: 'eu-west-1',
        hint: {
          kind: 'assume-role',
          roleArn: 'arn:aws:iam::123456789012:role/ScannerB',
        },
      }),
    );
  });

  it('supports simple mock providers that satisfy the contract', async () => {
    const getCredentials = vi.fn().mockResolvedValue({
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
    });
    const provider: AuthProvider = {
      kind: 'profile',
      getCredentials,
      canHandle: vi.fn().mockResolvedValue(true),
      describeAuthMethod: () => 'profile:test',
    };

    await expect(
      provider.getCredentials({
        accountId: '123456789012',
        partition: 'aws',
        region: 'eu-west-1',
      }),
    ).resolves.toMatchObject({
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
    });
  });
});
