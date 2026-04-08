import 'dotenv/config';

import { ServerLogger } from './adapters/server-logger.js';
import { PrismaInfrastructureRepository } from './adapters/prisma-infrastructure-repository.js';
import { PrismaScanRepository } from './adapters/prisma-scan-repository.js';
import { createApp } from './app.js';
import { createPrismaClient } from './config/database.js';
import { hasProductionLocalhostCors, loadConfig } from './config/env.js';
import { toError } from './errors/server-error.js';
import { PrismaAuditLogger } from './services/prisma-audit-logger.js';
import { DriftService } from './services/drift-service.js';
import { createScanDataEncryptionService } from './services/encryption.service.js';
import { ScanService } from './services/scan-service.js';
import { ServiceDetectionService } from './services/service-detection.service.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new ServerLogger(config);

  if (hasProductionLocalhostCors(config)) {
    logger.warn('startup.cors_origin_contains_localhost', {
      corsOrigin: config.corsOrigin,
    });
  }

  if (!config.encryptionKey) {
    logger.warn('STRONGHOLD_ENCRYPTION_KEY not set — scan data stored unencrypted');
  }

  const prisma = createPrismaClient(config);
  const encryptionService = createScanDataEncryptionService(config.encryptionKey);
  const auditLogger = new PrismaAuditLogger(prisma);
  const scanRepository = new PrismaScanRepository(prisma, encryptionService);
  const infrastructureRepository = new PrismaInfrastructureRepository(prisma, encryptionService);
  const serviceDetectionService = new ServiceDetectionService(
    scanRepository,
    infrastructureRepository,
    logger,
    config.servicesFilePath,
    config.governanceFilePath,
  );
  const scanService = new ScanService(
    scanRepository,
    infrastructureRepository,
    logger,
    serviceDetectionService,
    auditLogger,
  );
  const driftService = new DriftService(scanRepository, infrastructureRepository, logger);

  await prisma.$connect();

  const recoveredScans = await scanService.recoverOrphanedScans();
  if (recoveredScans > 0) {
    logger.warn('startup.recovered_orphan_scans', {
      recoveredScans,
    });
  }

  const app = createApp({
    config,
    prisma,
    logger,
    scanService,
    driftService,
    auditLogger,
  });
  const server = app.listen(config.port, () => {
    logger.info('server.started', { port: config.port });
  });

  const shutdown = async (): Promise<void> => {
    server.close();
    await prisma.$disconnect();
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

bootstrap().catch((error) => {
  const resolvedError = toError(error);
  // Intentional: bootstrap failed before structured logging could take over.
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'server.bootstrap.failed',
      error: resolvedError.message,
      stack: resolvedError.stack,
      timestamp: new Date().toISOString(),
    }),
  );
  process.exitCode = 1;
});
