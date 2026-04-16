import { describe, expect, it } from 'vitest';

import {
  createAccountContext,
  isValidAccountId,
} from './account.js';

describe('account identity helpers', () => {
  it('accepts valid 12-digit AWS account ids', () => {
    expect(isValidAccountId('123456789012')).toBe(true);
  });

  it.each(['12345', '1234567890123', '12345678901a'])(
    'rejects invalid account id %j',
    (value) => {
      expect(isValidAccountId(value)).toBe(false);
    },
  );

  it('creates an account context', () => {
    expect(
      createAccountContext({
        accountId: '123456789012',
        accountAlias: 'production',
        partition: 'aws-us-gov',
      }),
    ).toEqual({
      accountId: '123456789012',
      accountAlias: 'production',
      partition: 'aws-us-gov',
    });
  });

  it('throws when building a context with an invalid account id', () => {
    expect(() =>
      createAccountContext({
        accountId: 'invalid',
      }),
    ).toThrow('Invalid AWS account ID');
  });

  it('defaults the partition to aws and normalizes a missing alias to null', () => {
    expect(
      createAccountContext({
        accountId: '123456789012',
      }),
    ).toEqual({
      accountId: '123456789012',
      accountAlias: null,
      partition: 'aws',
    });
  });

  it('throws when building a context with an invalid partition', () => {
    expect(() =>
      createAccountContext({
        accountId: '123456789012',
        partition: 'aws-iso',
      }),
    ).toThrow('Invalid AWS partition');
  });
});
