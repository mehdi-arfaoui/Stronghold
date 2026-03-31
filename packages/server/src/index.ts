import 'dotenv/config';

import { ServerLogger } from './adapters/server-logger.js';
import { PrismaInfrastructureRepository } from './adapters/prisma-infrastructure-repository.js';
import { PrismaScanRepository } from './adapters/prisma-scan-repository.js';
import { createApp } from './app.js';
import { createPrismaClient } from './config/database.js';
import { hasProductionLocalhostCors, loadConfig } from './config/env.js';
import { toError } from './errors/server-error.js';
import { DriftService } from './services/drift-service.js';
import { ScanService } from './services/scan-service.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new ServerLogger(config);

  if (hasProductionLocalhostCors(config)) {
    logger.warn('startup.cors_origin_contains_localhost', {
      corsOrigin: config.corsOrigin,
    });
  }

  const prisma = createPrismaClient(config);
  const scanRepository = new PrismaScanRepository(prisma);
  const infrastructureRepository = new PrismaInfrastructureRepository(prisma);
  const scanService = new ScanService(scanRepository, infrastructureRepository, logger);
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
