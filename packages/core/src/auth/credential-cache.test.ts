import { afterEach, describe, expect, it, vi } from 'vitest';

import { CredentialCache } from './credential-cache.js';

describe('CredentialCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the fetcher on a cache miss', async () => {
    const cache = new CredentialCache();
    const fetcher = vi.fn().mockResolvedValue({
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
    });

    await expect(cache.get('profile:test', fetcher)).resolves.toMatchObject({
      accessKeyId: 'AKIA_TEST',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({
      hits: 0,
      misses: 1,
      refreshes: 0,
      size: 1,
    });
  });

  it('returns the cached entry when credentials are still valid', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T10:00:00.000Z'));

    const cache = new CredentialCache();
    const fetcher = vi.fn().mockResolvedValue({
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
      expiration: new Date('2026-04-16T11:00:00.000Z'),
    });

    await cache.get('profile:test', fetcher);
    await cache.get('profile:test', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({
      hits: 1,
      misses: 1,
      refreshes: 0,
      size: 1,
    });
  });

  it('refreshes when credentials are close to expiration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T10:00:00.000Z'));

    const cache = new CredentialCache();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        accessKeyId: 'AKIA_OLD',
        secretAccessKey: 'secret-old',
        expiration: new Date('2026-04-16T10:03:00.000Z'),
      })
      .mockResolvedValueOnce({
        accessKeyId: 'AKIA_NEW',
        secretAccessKey: 'secret-new',
        expiration: new Date('2026-04-16T11:00:00.000Z'),
      });

    await cache.get('assume-role:test', fetcher);
    await expect(cache.get('assume-role:test', fetcher)).resolves.toMatchObject({
      accessKeyId: 'AKIA_NEW',
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cache.stats()).toMatchObject({
      hits: 0,
      misses: 1,
      refreshes: 1,
      size: 1,
    });
  });

  it('invalidates entries explicitly', async () => {
    const cache = new CredentialCache();
    const fetcher = vi.fn().mockResolvedValue({
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
    });

    await cache.get('profile:test', fetcher);
    cache.invalidate('profile:test');
    await cache.get('profile:test', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cache.stats().size).toBe(1);
  });

  it('never refreshes static credentials without expiration', async () => {
    const cache = new CredentialCache();
    const fetcher = vi.fn().mockResolvedValue({
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
    });

    await cache.get('profile:test', fetcher);
    await cache.get('profile:test', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({
      hits: 1,
      misses: 1,
      refreshes: 0,
      size: 1,
    });
  });
});
