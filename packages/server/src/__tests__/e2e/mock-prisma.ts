import type { PrismaClient } from '@prisma/client';
import { vi } from 'vitest';

import {
  createRelatedRecord,
  createScanRecord,
  createStore,
  deleteManyScans,
  findManyRecords,
  findFirstScan,
  findLatestByScanId,
  findManyScans,
  findUniqueScan,
  listLatestByScanId,
  resetStore,
  runTransaction,
  updateManyScans,
  updateScanRecord,
  upsertByScanId,
  withFallback,
  type MockPrismaStore,
  type UnknownRecord,
} from './mock-prisma-store.js';

export interface MockPrismaHarness {
  readonly prisma: PrismaClient;
  readonly store: MockPrismaStore;
}

/**
 * These E2E tests validate Express wiring and service orchestration.
 * Prisma is simulated in-memory here, so they do not cover the real Prisma/PostgreSQL layer.
 */
export function createMockPrisma(): MockPrismaHarness {
  const store = createStore();

  const scan = withFallback('scan', {
    create: vi.fn(async (args: { readonly data: UnknownRecord }) => createScanRecord(store, args.data)),
    upsert: vi.fn(async (args: { readonly where: { readonly id: string }; readonly create: UnknownRecord; readonly update: UnknownRecord }) => {
      const existing = store.scans.get(args.where.id);
      if (!existing) {
        return createScanRecord(store, args.create);
      }
      return updateScanRecord(store, args.where.id, args.update);
    }),
    update: vi.fn(async (args: { readonly where: { readonly id: string }; readonly data: UnknownRecord }) => updateScanRecord(store, args.where.id, args.data)),
    updateMany: vi.fn(async (args: { readonly where?: UnknownRecord; readonly data: UnknownRecord }) => updateManyScans(store, args.where, args.data)),
    findUnique: vi.fn(async (args: { readonly where: { readonly id: string }; readonly include?: { readonly scanData?: boolean } }) => findUniqueScan(store, args.where.id, args.include?.scanData === true)),
    findFirst: vi.fn(async (args: { readonly where?: UnknownRecord; readonly include?: { readonly scanData?: boolean } }) => findFirstScan(store, args.where, args.include?.scanData === true)),
    findMany: vi.fn(async (args: { readonly take?: number; readonly cursor?: { readonly id: string }; readonly skip?: number }) => findManyScans(store, args)),
    deleteMany: vi.fn(async (args: { readonly where?: { readonly id?: string } }) => deleteManyScans(store, args.where?.id)),
  });
  const scanData = withFallback('scanData', {
    upsert: vi.fn(async (args: { readonly where: { readonly scanId: string }; readonly create: UnknownRecord; readonly update: UnknownRecord }) => upsertByScanId(store.scanData, args.where.scanId, args.create, args.update)),
    findUnique: vi.fn(async (args: { readonly where: { readonly scanId: string } }) => store.scanData.get(args.where.scanId) ?? null),
  });
  const report = withFallback('report', {
    create: vi.fn(async (args: { readonly data: UnknownRecord }) => createRelatedRecord(store.reports, args.data)),
    findFirst: vi.fn(async (args: { readonly where?: { readonly scanId?: string } }) => findLatestByScanId(store.reports, args.where?.scanId)),
  });
  const dRPlan = withFallback('dRPlan', {
    create: vi.fn(async (args: { readonly data: UnknownRecord }) => createRelatedRecord(store.drPlans, args.data)),
    findFirst: vi.fn(async (args: { readonly where?: { readonly scanId?: string } }) => findLatestByScanId(store.drPlans, args.where?.scanId)),
  });
  const planValidation = withFallback('planValidation', {
    create: vi.fn(async (args: { readonly data: UnknownRecord }) => createRelatedRecord(store.planValidations, args.data)),
  });
  const driftEvent = withFallback('driftEvent', {
    create: vi.fn(async (args: { readonly data: UnknownRecord }) => createRelatedRecord(store.driftEvents, args.data)),
    findMany: vi.fn(async (args: { readonly where?: { readonly scanId?: string } }) => listLatestByScanId(store.driftEvents, args.where?.scanId)),
  });
  const auditLog = withFallback('auditLog', {
    create: vi.fn(async (args: { readonly data: UnknownRecord }) => createRelatedRecord(store.auditLogs, args.data)),
    findMany: vi.fn(
      async (args: { readonly take?: number; readonly cursor?: { readonly id: string }; readonly skip?: number }) =>
        findManyRecords(store.auditLogs, args),
    ),
  });

  const transactionClient = { scan, scanData, report, dRPlan, planValidation, driftEvent, auditLog };
  const prisma = {
    ...transactionClient,
    $connect: vi.fn(async () => undefined),
    $disconnect: vi.fn(async () => undefined),
    $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
    $transaction: vi.fn(async (input: unknown) => runTransaction(input, transactionClient)),
  } as unknown as PrismaClient;

  return { prisma, store };
}
export { resetStore };
