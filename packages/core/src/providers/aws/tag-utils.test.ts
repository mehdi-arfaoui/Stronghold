import { describe, expect, it, vi } from 'vitest';

import { fetchAwsTagsWithRetry, normalizeTagMap, tagsArrayToMap } from './tag-utils.js';

describe('tagsArrayToMap', () => {
  it('converts AWS tag arrays into flat maps', () => {
    expect(
      tagsArrayToMap([
        { Key: 'service', Value: 'payment' },
        { key: 'Environment', value: 'test' },
        { Key: 'Name', Value: 'payment-db' },
      ]),
    ).toEqual({
      service: 'payment',
      Environment: 'test',
      Name: 'payment-db',
    });
  });

  it('ignores empty keys and keeps empty values', () => {
    expect(
      tagsArrayToMap([
        { Key: 'service', Value: '' },
        { Key: '   ', Value: 'ignored' },
        { Value: 'missing-key' },
      ]),
    ).toEqual({ service: '' });
  });
});

describe('normalizeTagMap', () => {
  it('normalizes key-value tag maps', () => {
    expect(
      normalizeTagMap({
        service: 'payment',
        Environment: 'prod',
        EmptyValue: undefined,
      }),
    ).toEqual({
      service: 'payment',
      Environment: 'prod',
      EmptyValue: '',
    });
  });
});

describe('fetchAwsTagsWithRetry', () => {
  it('returns tags when the request succeeds', async () => {
    await expect(
      fetchAwsTagsWithRetry(
        async () => ({ TagList: [{ Key: 'service', Value: 'auth' }] }),
        (response) => tagsArrayToMap(response.TagList),
        {
          description: 'RDS tag discovery unavailable in eu-west-1',
        },
      ),
    ).resolves.toEqual({ service: 'auth' });
  });

  it('returns empty tags and warns once on access denied', async () => {
    const warnings: string[] = [];
    const error = new Error('denied');
    error.name = 'AccessDeniedException';

    await expect(
      fetchAwsTagsWithRetry(
        async () => {
          throw error;
        },
        () => ({}),
        {
          description: 'Lambda tag discovery unavailable in eu-west-1',
          warnings,
          warningDeduper: new Set<string>(),
        },
      ),
    ).resolves.toEqual({});

    expect(warnings).toEqual([
      'Lambda tag discovery unavailable in eu-west-1 (AccessDeniedException). Continuing without tags.',
    ]);
  });

  it('treats NoSuchTagSet as an empty result', async () => {
    const error = new Error('no tags');
    error.name = 'NoSuchTagSet';

    await expect(
      fetchAwsTagsWithRetry(
        async () => {
          throw error;
        },
        () => ({ shouldNotAppear: 'value' }),
        {
          description: 'S3 tag discovery unavailable in eu-west-1',
          ignoreErrorCodes: ['NoSuchTagSet'],
        },
      ),
    ).resolves.toEqual({});
  });

  it('retries throttling errors before succeeding', async () => {
    vi.useFakeTimers();
    let attempts = 0;

    const promise = fetchAwsTagsWithRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('too many requests');
          error.name = 'TooManyRequestsException';
          throw error;
        }
        return { Tags: { service: 'orders' } };
      },
      (response) => normalizeTagMap(response.Tags),
      {
        description: 'SQS tag discovery unavailable in eu-west-1',
        random: () => 0,
      },
    );

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ service: 'orders' });
    expect(attempts).toBe(2);
    vi.useRealTimers();
  });
});
