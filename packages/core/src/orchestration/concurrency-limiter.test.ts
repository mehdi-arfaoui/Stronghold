import { describe, expect, it } from 'vitest';

import { ConcurrencyLimiter } from './concurrency-limiter.js';

describe('ConcurrencyLimiter', () => {
  it('caps concurrent execution at the configured limit', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 5 }, (_, index) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await wait(10 + index);
      running -= 1;
      return index;
    });

    const results = await limiter.all(tasks);

    expect(maxRunning).toBe(2);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  });

  it('runs sequentially when maxConcurrency is 1', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const completionOrder: number[] = [];

    const results = await limiter.all([
      async () => {
        await wait(5);
        completionOrder.push(1);
        return 1;
      },
      async () => {
        await wait(5);
        completionOrder.push(2);
        return 2;
      },
      async () => {
        await wait(5);
        completionOrder.push(3);
        return 3;
      },
    ]);

    expect(completionOrder).toEqual([1, 2, 3]);
    expect(results).toEqual([
      { status: 'fulfilled', value: 1 },
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 3 },
    ]);
  });

  it('releases the slot when one task throws and lets the others continue', async () => {
    const limiter = new ConcurrencyLimiter(2);

    const results = await limiter.all([
      async () => {
        await wait(5);
        return 'first';
      },
      async () => {
        await wait(2);
        throw new Error('boom');
      },
      async () => {
        await wait(5);
        return 'third';
      },
    ]);

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'first' });
    expect(results[1]?.status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'third' });
    expect(limiter.activeCount).toBe(0);
    expect(limiter.pendingCount).toBe(0);
  });

  it('returns a settled result for each task in all()', async () => {
    const limiter = new ConcurrencyLimiter(2);

    const results = await limiter.all([
      async () => 'ok',
      async () => {
        throw new Error('nope');
      },
      async () => 'still-ok',
    ]);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok' });
    expect(results[1]?.status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'still-ok' });
  });

  it('tracks activeCount and pendingCount across handoffs', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const first = createDeferred<undefined>();
    const second = createDeferred<undefined>();
    const third = createDeferred<undefined>();

    const execution = limiter.all([
      async () => {
        await first.promise;
        return 'first';
      },
      async () => {
        await second.promise;
        return 'second';
      },
      async () => {
        await third.promise;
        return 'third';
      },
    ]);

    await Promise.resolve();
    expect(limiter.activeCount).toBe(1);
    expect(limiter.pendingCount).toBe(2);

    first.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(limiter.activeCount).toBe(1);
    expect(limiter.pendingCount).toBe(1);

    second.resolve(undefined);
    await wait(0);
    expect(limiter.activeCount).toBe(1);
    expect(limiter.pendingCount).toBe(0);

    third.resolve(undefined);
    await execution;
    expect(limiter.activeCount).toBe(0);
    expect(limiter.pendingCount).toBe(0);
  });

  it('starts all tasks immediately when capacity exceeds demand', async () => {
    const limiter = new ConcurrencyLimiter(100);
    let started = 0;

    const execution = limiter.all([
      async () => {
        started += 1;
        await wait(5);
        return 1;
      },
      async () => {
        started += 1;
        await wait(5);
        return 2;
      },
      async () => {
        started += 1;
        await wait(5);
        return 3;
      },
    ]);

    await Promise.resolve();
    expect(started).toBe(3);
    expect(limiter.activeCount).toBe(3);

    await execution;
  });

  it('rejects invalid maxConcurrency values', () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow(/positive integer/);
    expect(() => new ConcurrencyLimiter(-1)).toThrow(/positive integer/);
    expect(() => new ConcurrencyLimiter(1.5)).toThrow(/positive integer/);
  });

  it('preserves FIFO order for same-duration queued tasks', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const completionOrder: number[] = [];

    await limiter.all([
      async () => {
        await wait(10);
        completionOrder.push(1);
        return 1;
      },
      async () => {
        await wait(10);
        completionOrder.push(2);
        return 2;
      },
      async () => {
        await wait(10);
        completionOrder.push(3);
        return 3;
      },
      async () => {
        await wait(10);
        completionOrder.push(4);
        return 4;
      },
    ]);

    expect(completionOrder).toEqual([1, 2, 3, 4]);
  });

  it('handles many trivial tasks quickly', async () => {
    const limiter = new ConcurrencyLimiter(10);
    const startedAt = Date.now();

    const results = await limiter.all(
      Array.from({ length: 1000 }, (_, index) => async () => index),
    );

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(results).toHaveLength(1000);
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDeferred<TValue>() {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void;
  const promise = new Promise<TValue>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}
