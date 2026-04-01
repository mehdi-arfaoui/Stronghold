import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { PrismaClient } from '@prisma/client';

import type { ServerLogger } from './adapters/server-logger.js';
import type { ServerConfig } from './config/env.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { globalLimiter } from './middleware/rate-limiter.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createDriftRoutes } from './routes/drift.routes.js';
import { createHealthRoutes } from './routes/health.routes.js';
import { createPlanRoutes } from './routes/plan.routes.js';
import { createReportRoutes } from './routes/report.routes.js';
import { createScanRoutes } from './routes/scan.routes.js';
import { createAuditRoutes } from './routes/audit.routes.js';
import type { DriftService } from './services/drift-service.js';
import { PrismaAuditLogger } from './services/prisma-audit-logger.js';
import type { ScanService } from './services/scan-service.js';

export interface AppDependencies {
  readonly config: ServerConfig;
  readonly prisma: PrismaClient;
  readonly logger: ServerLogger;
  readonly scanService: ScanService;
  readonly driftService: DriftService;
  readonly auditLogger: PrismaAuditLogger;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: [...dependencies.config.corsOrigins],
    }),
  );
  app.use('/api', globalLimiter);
  app.use(express.json({ limit: '10mb' }));
  app.use(createRequestLogger(dependencies.logger));

  app.use(
    '/api/scans',
    createScanRoutes(dependencies.scanService, dependencies.auditLogger, dependencies.logger),
  );
  app.use(
    '/api',
    createReportRoutes(dependencies.scanService, dependencies.auditLogger, dependencies.logger),
  );
  app.use(
    '/api',
    createPlanRoutes(dependencies.scanService, dependencies.auditLogger, dependencies.logger),
  );
  app.use(
    '/api',
    createDriftRoutes(dependencies.driftService, dependencies.auditLogger, dependencies.logger),
  );
  app.use('/api', createAuditRoutes(dependencies.auditLogger));
  app.use('/api', createHealthRoutes(dependencies.prisma));
  app.use(createErrorHandler(dependencies.config));

  return app;
}
