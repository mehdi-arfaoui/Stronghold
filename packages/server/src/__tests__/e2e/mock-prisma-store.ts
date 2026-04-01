import crypto from 'node:crypto';

import { vi } from 'vitest';

export type ScanStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';
export type UnknownRecord = Record<string, unknown>;

export interface MockScanRecord {
  readonly id: string;
  readonly provider: string;
  readonly regions: readonly string[];
  readonly status: ScanStatus;
  readonly resourceCount: number;
  readonly edgeCount: number;
  readonly score: number | null;
  readonly grade: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MockRelatedRecord extends UnknownRecord {
  readonly id: string;
  readonly createdAt: Date;
}

export interface MockPrismaStore {
  readonly scans: Map<string, MockScanRecord>;
  readonly scanData: Map<string, UnknownRecord>;
  readonly reports: Map<string, MockRelatedRecord>;
  readonly drPlans: Map<string, MockRelatedRecord>;
  readonly planValidations: Map<string, MockRelatedRecord>;
  readonly driftEvents: Map<string, MockRelatedRecord>;
  readonly auditLogs: Map<string, MockRelatedRecord>;
  tick: number;
}

export function createStore(): MockPrismaStore {
  return {
    scans: new Map(),
    scanData: new Map(),
    reports: new Map(),
    drPlans: new Map(),
    planValidations: new Map(),
    driftEvents: new Map(),
    auditLogs: new Map(),
    tick: 0,
  };
}

export function resetStore(store: MockPrismaStore): void {
  store.scans.clear();
  store.scanData.clear();
  store.reports.clear();
  store.drPlans.clear();
  store.planValidations.clear();
  store.driftEvents.clear();
  store.auditLogs.clear();
  store.tick = 0;
}

export function withFallback<T extends UnknownRecord>(delegate: string, methods: T): T {
  return new Proxy(methods, {
    get(target, property, receiver) {
      if (Reflect.has(target, property) || typeof property !== 'string') {
        return Reflect.get(target, property, receiver);
      }
      const fallback = vi.fn(async () => {
        throw new Error(`Unexpected Prisma.${delegate}.${property} call in E2E mock.`);
      });
      const targetWithIndex = target as UnknownRecord;
      targetWithIndex[property] = fallback;
      return fallback;
    },
  });
}

export function createScanRecord(store: MockPrismaStore, data: UnknownRecord): MockScanRecord {
  const record: MockScanRecord = {
    id: typeof data.id === 'string' ? data.id : crypto.randomUUID(),
    provider: typeof data.provider === 'string' ? data.provider : 'aws',
    regions: toStringArray(data.regions),
    status: isScanStatus(data.status) ? data.status : 'PENDING',
    resourceCount: toNumber(data.resourceCount),
    edgeCount: toNumber(data.edgeCount),
    score: typeof data.score === 'number' ? data.score : null,
    grade: typeof data.grade === 'string' ? data.grade : null,
    errorMessage: typeof data.errorMessage === 'string' ? data.errorMessage : null,
    createdAt: data.createdAt instanceof Date ? data.createdAt : nextDate(store),
    updatedAt: nextDate(store),
  };
  store.scans.set(record.id, record);
  return record;
}

export function updateScanRecord(store: MockPrismaStore, id: string, data: UnknownRecord): MockScanRecord {
  const current = store.scans.get(id);
  if (!current) {
    throw new Error(`Scan ${id} was not found in the E2E Prisma mock.`);
  }
  const updated: MockScanRecord = {
    ...current,
    ...data,
    regions: data.regions === undefined ? current.regions : toStringArray(data.regions),
    status: isScanStatus(data.status) ? data.status : current.status,
    updatedAt: nextDate(store),
  };
  store.scans.set(id, updated);
  return updated;
}

export function updateManyScans(store: MockPrismaStore, where: UnknownRecord | undefined, data: UnknownRecord): { readonly count: number } {
  const status = where?.status;
  let count = 0;
  store.scans.forEach((record) => {
    if (status !== undefined && record.status !== status) {
      return;
    }
    updateScanRecord(store, record.id, data);
    count += 1;
  });
  return { count };
}

export function findUniqueScan(store: MockPrismaStore, id: string, includeScanData: boolean): unknown {
  const scan = store.scans.get(id);
  if (!scan) {
    return null;
  }
  return includeScanData ? { ...scan, scanData: store.scanData.get(id) ?? null } : scan;
}

export function findFirstScan(store: MockPrismaStore, where: UnknownRecord | undefined, includeScanData: boolean): unknown {
  const match = [...store.scans.values()]
    .filter((record) => (where?.provider ? record.provider === where.provider : true))
    .filter((record) => (where?.status ? record.status === where.status : true))
    .sort(compareByCreatedAtDesc)[0];
  return match ? findUniqueScan(store, match.id, includeScanData) : null;
}

export function findManyScans(store: MockPrismaStore, args: { readonly take?: number; readonly cursor?: { readonly id: string }; readonly skip?: number }): readonly MockScanRecord[] {
  const ordered = [...store.scans.values()].sort(compareByCreatedAtDesc);
  const startIndex = args.cursor ? ordered.findIndex((record) => record.id === args.cursor?.id) + (args.skip ?? 0) : 0;
  const sliceStart = Math.max(startIndex, 0);
  return ordered.slice(sliceStart, args.take === undefined ? undefined : sliceStart + args.take);
}

export function deleteManyScans(store: MockPrismaStore, id: string | undefined): { readonly count: number } {
  if (!id || !store.scans.has(id)) {
    return { count: 0 };
  }
  store.scans.delete(id);
  store.scanData.delete(id);
  deleteByScanId(store.reports, id);
  deleteByScanId(store.drPlans, id);
  deleteByScanId(store.driftEvents, id);
  return { count: 1 };
}

export function createRelatedRecord(collection: Map<string, MockRelatedRecord>, data: UnknownRecord): MockRelatedRecord {
  const record: MockRelatedRecord = { id: typeof data.id === 'string' ? data.id : crypto.randomUUID(), createdAt: new Date(), ...data };
  collection.set(record.id, record);
  return record;
}

export function upsertByScanId(collection: Map<string, UnknownRecord>, scanId: string, create: UnknownRecord, update: UnknownRecord): UnknownRecord {
  const nextValue = collection.has(scanId) ? { ...collection.get(scanId), ...update } : { id: crypto.randomUUID(), ...create };
  collection.set(scanId, nextValue);
  return nextValue;
}

export function findLatestByScanId(collection: Map<string, MockRelatedRecord>, scanId: string | undefined): MockRelatedRecord | null {
  return listLatestByScanId(collection, scanId)[0] ?? null;
}

export function listLatestByScanId(collection: Map<string, MockRelatedRecord>, scanId: string | undefined): readonly MockRelatedRecord[] {
  return [...collection.values()]
    .filter((record) => (scanId ? record.scanId === scanId : true))
    .sort(compareByCreatedAtDesc);
}

export function findManyRecords(
  collection: Map<string, MockRelatedRecord>,
  args: {
    readonly take?: number;
    readonly cursor?: { readonly id: string };
    readonly skip?: number;
  },
): readonly MockRelatedRecord[] {
  const ordered = [...collection.values()].sort(compareByCreatedAtDesc);
  const startIndex = args.cursor
    ? ordered.findIndex((record) => record.id === args.cursor?.id) + (args.skip ?? 0)
    : 0;
  const sliceStart = Math.max(startIndex, 0);
  return ordered.slice(
    sliceStart,
    args.take === undefined ? undefined : sliceStart + args.take,
  );
}

export async function runTransaction(input: unknown, client: UnknownRecord): Promise<unknown> {
  if (typeof input === 'function') {
    return input(client);
  }
  if (Array.isArray(input)) {
    const results: unknown[] = [];
    for (const operation of input) {
      results.push(await operation);
    }
    return results;
  }
  return input;
}

function deleteByScanId(collection: Map<string, MockRelatedRecord>, scanId: string): void {
  collection.forEach((record, id) => {
    if (record.scanId === scanId) {
      collection.delete(id);
    }
  });
}

function compareByCreatedAtDesc(left: { readonly createdAt: Date; readonly id: string }, right: { readonly createdAt: Date; readonly id: string }): number {
  return right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id);
}

function nextDate(store: MockPrismaStore): Date {
  store.tick += 1;
  return new Date(Date.UTC(2026, 2, 27, 12, 0, store.tick));
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function isScanStatus(value: unknown): value is ScanStatus {
  return value === 'PENDING' || value === 'RUNNING' || value === 'COMPLETED' || value === 'FAILED' || value === 'PARTIAL';
}
