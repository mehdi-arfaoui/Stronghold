import { setTimeout as delay } from 'node:timers/promises';

import { serializeDRPlan, validateDRPlan } from '@stronghold-dr/core';
import { vi } from 'vitest';

import { ServerLogger } from '../../adapters/server-logger.js';
import { PrismaInfrastructureRepository } from '../../adapters/prisma-infrastructure-repository.js';
import { PrismaScanRepository, type SaveScanParams } from '../../adapters/prisma-scan-repository.js';
import { createApp, type AppDependencies } from '../../app.js';
import type { ServerConfig } from '../../config/env.js';
import { DriftService } from '../../services/drift-service.js';
import { createScanDataEncryptionService } from '../../services/encryption.service.js';
import { PrismaAuditLogger } from '../../services/prisma-audit-logger.js';
import { ScanService } from '../../services/scan-service.js';
import { buildDemoArtifacts, createDemoScenario, type DemoScenario } from './fixtures.js';
import { createMockPrisma, resetStore, type MockPrismaHarness } from './mock-prisma.js';

export interface E2eContext {
  readonly app: ReturnType<typeof createApp>;
  readonly prisma: MockPrismaHarness;
  readonly scanRepository: PrismaScanRepository;
  readonly infrastructureRepository: PrismaInfrastructureRepository;
  readonly scanService: ScanService;
  readonly auditLogger: PrismaAuditLogger;
}

export function createE2eContext(
  options: {
    readonly autoCompleteScan?: boolean;
    readonly encryptionKey?: string;
  } = {},
): E2eContext {
  const prisma = createMockPrisma();
  resetStore(prisma.store);
  const config: ServerConfig = {
    port: 3000,
    databaseUrl: 'postgresql://stronghold:stronghold@localhost:5432/stronghold',
    nodeEnv: 'test',
    corsOrigin: 'http://localhost:5173',
    corsOrigins: ['http://localhost:5173'],
    logLevel: 'error',
    ...(options.encryptionKey ? { encryptionKey: options.encryptionKey } : {}),
  };
  const logger = new ServerLogger(config);
  const encryptionService = createScanDataEncryptionService(options.encryptionKey);
  const auditLogger = new PrismaAuditLogger(prisma.prisma);
  const scanRepository = new PrismaScanRepository(prisma.prisma, encryptionService);
  const infrastructureRepository = new PrismaInfrastructureRepository(
    prisma.prisma,
    encryptionService,
  );
  const scanService = new ScanService(scanRepository, infrastructureRepository, logger);
  const driftService = new DriftService(scanRepository, infrastructureRepository, logger);

  if (options.autoCompleteScan) {
    const scanServiceInternals = scanService as unknown as {
      runAwsScan: () => Promise<unknown>;
    };
    vi.spyOn(scanServiceInternals, 'runAwsScan').mockImplementation(async () => ({
      timestamp: new Date('2026-03-27T15:00:00.000Z'),
      warnings: ['Demo E2E data used in place of a live AWS scan.'],
      artifacts: await buildDemoArtifacts(createDemoScenario()),
    }));
  }

  const dependencies: AppDependencies = {
    config,
    prisma: prisma.prisma,
    logger,
    scanService,
    driftService,
    auditLogger,
  };

  return {
    app: createApp(dependencies),
    prisma,
    scanRepository,
    infrastructureRepository,
    scanService,
    auditLogger,
  };
}

export async function seedCompletedScan(
  context: E2eContext,
  options: {
    readonly scanId: string;
    readonly scenario?: DemoScenario;
    readonly timestamp?: Date;
    readonly persistPlan?: boolean;
  },
): Promise<void> {
  const scenario = options.scenario ?? createDemoScenario();
  const timestamp = options.timestamp ?? new Date('2026-03-27T15:00:00.000Z');
  const artifacts = await buildDemoArtifacts(scenario);
  const params: SaveScanParams = {
    scanId: options.scanId,
    provider: scenario.provider,
    region: scenario.regions[0],
    regions: scenario.regions,
    timestamp,
    nodes: artifacts.nodes,
    edges: artifacts.edges,
    metadata: {},
    analysis: artifacts.serializedAnalysis,
    validationReport: artifacts.validationReport,
    status: 'COMPLETED',
  };

  await context.scanRepository.saveScan(params);
  if (!options.persistPlan) {
    return;
  }

  await context.scanRepository.saveReport({
    scanId: options.scanId,
    type: 'validation',
    format: 'json',
    content: artifacts.validationReport,
    score: artifacts.validationReport.scoreBreakdown.overall,
    grade: artifacts.validationReport.scoreBreakdown.grade,
  });
  const validation = validateDRPlan(artifacts.drPlan, artifacts.graph);
  const planId = await context.scanRepository.saveDRPlan({
    scanId: options.scanId,
    format: 'yaml',
    content: serializeDRPlan(artifacts.drPlan, 'yaml'),
    plan: artifacts.drPlan,
    isValid: validation.isValid,
  });
  await context.scanRepository.savePlanValidation(planId, validation);
}

export async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
): Promise<T> {
  const startedAt = Date.now();
  let current = await read();

  while (!predicate(current)) {
    if (Date.now() - startedAt > 2_000) {
      throw new Error('Timed out while waiting for E2E condition.');
    }
    await delay(25);
    current = await read();
  }

  return current;
}
