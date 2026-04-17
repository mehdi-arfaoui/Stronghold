export type SettledResult<TValue> =
  | { status: 'fulfilled'; value: TValue }
  | { status: 'rejected'; reason: unknown };

/**
 * Limiteur de concurrence FIFO sans dépendance externe.
 */
export class ConcurrencyLimiter {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  public constructor(private readonly maxConcurrency: number) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error(
        `maxConcurrency must be a positive integer, got ${String(maxConcurrency)}`,
      );
    }
  }

  public async run<TValue>(fn: () => Promise<TValue>): Promise<TValue> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  public async all<TValue>(
    tasks: ReadonlyArray<() => Promise<TValue>>,
  ): Promise<Array<SettledResult<TValue>>> {
    return Promise.all(tasks.map((task) => this.runSettled(task)));
  }

  public get activeCount(): number {
    return this.running;
  }

  public get pendingCount(): number {
    return this.queue.length;
  }

  private acquire(): Promise<void> {
    if (this.running < this.maxConcurrency && this.queue.length === 0) {
      this.running += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    this.running -= 1;

    const next = this.queue.shift();
    if (!next) {
      return;
    }

    // Reserve the slot before waking the next task so FIFO handoff
    // stays deterministic even if another release happens first.
    this.running += 1;
    queueMicrotask(next);
  }

  private async runSettled<TValue>(
    fn: () => Promise<TValue>,
  ): Promise<SettledResult<TValue>> {
    try {
      return {
        status: 'fulfilled',
        value: await this.run(fn),
      };
    } catch (error) {
      return {
        status: 'rejected',
        reason: error,
      };
    }
  }
}
