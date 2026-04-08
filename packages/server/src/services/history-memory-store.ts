import type {
  FindingLifecycle,
  FindingLifecycleStore,
} from '@stronghold-dr/core';

export class InMemoryFindingLifecycleStore implements FindingLifecycleStore {
  private readonly entries = new Map<string, FindingLifecycle>();

  public constructor(initialEntries: readonly FindingLifecycle[] = []) {
    initialEntries.forEach((entry) => {
      this.entries.set(entry.findingKey, stripComputedAge(entry));
    });
  }

  public async upsert(lifecycle: FindingLifecycle): Promise<void> {
    this.entries.set(lifecycle.findingKey, stripComputedAge(lifecycle));
  }

  public async upsertMany(lifecycles: readonly FindingLifecycle[]): Promise<void> {
    lifecycles.forEach((lifecycle) => {
      this.entries.set(lifecycle.findingKey, stripComputedAge(lifecycle));
    });
  }

  public async getByKey(
    findingKey: string,
    asOf = new Date().toISOString(),
  ): Promise<FindingLifecycle | null> {
    const lifecycle = this.entries.get(findingKey);
    return lifecycle ? hydrateLifecycle(lifecycle, asOf) : null;
  }

  public async getActive(asOf = new Date().toISOString()): Promise<readonly FindingLifecycle[]> {
    return this.getAll(asOf).then((entries) =>
      entries.filter((entry) => entry.status === 'active' || entry.status === 'recurrent'),
    );
  }

  public async getResolved(
    since?: string,
    asOf = new Date().toISOString(),
  ): Promise<readonly FindingLifecycle[]> {
    return this.getAll(asOf).then((entries) =>
      entries.filter(
        (entry) =>
          entry.status === 'resolved' &&
          (!since || (entry.resolvedAt !== undefined && entry.resolvedAt >= since)),
      ),
    );
  }

  public async getRecurrent(asOf = new Date().toISOString()): Promise<readonly FindingLifecycle[]> {
    return this.getAll(asOf).then((entries) => entries.filter((entry) => entry.isRecurrent));
  }

  public async getAll(asOf = new Date().toISOString()): Promise<readonly FindingLifecycle[]> {
    return Array.from(this.entries.values())
      .map((entry) => hydrateLifecycle(entry, asOf))
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  }
}

function stripComputedAge(lifecycle: FindingLifecycle): FindingLifecycle {
  return {
    ...lifecycle,
    ageInDays: 0,
  };
}

function hydrateLifecycle(lifecycle: FindingLifecycle, asOf: string): FindingLifecycle {
  const referenceTimestamp =
    lifecycle.resolvedAt && lifecycle.resolvedAt < asOf ? lifecycle.resolvedAt : asOf;

  return {
    ...lifecycle,
    ageInDays: diffDays(lifecycle.firstSeenAt, referenceTimestamp),
  };
}

function diffDays(startAt: string, endAt: string): number {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 0;
  }
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}
