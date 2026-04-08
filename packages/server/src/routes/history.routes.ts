import { Router } from 'express';
import type { Logger } from '@stronghold-dr/core';

import { asyncHandler } from '../middleware/async-handler.js';
import { validateQuery } from '../middleware/validate.js';
import { PrismaAuditLogger } from '../services/prisma-audit-logger.js';
import { RequestAuditSession } from '../services/request-audit.js';
import { ScanService } from '../services/scan-service.js';
import { getSingleValue } from '../utils/request-values.js';
import { historyQuerySchema } from './route-schemas.js';

export function createHistoryRoutes(
  scanService: ScanService,
  auditLogger: PrismaAuditLogger,
  logger: Logger,
): Router {
  const router = Router();

  router.get(
    '/history',
    validateQuery(historyQuerySchema),
    asyncHandler(async (request, response) => {
      const query = request.query as unknown as { limit: number };
      const audit = new RequestAuditSession(auditLogger, logger, 'history', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const history = await scanService.listHistory({ limit: query.limit });
        response.json(history);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get(
    '/history/trend',
    validateQuery(historyQuerySchema),
    asyncHandler(async (request, response) => {
      const query = request.query as unknown as { limit: number };
      const audit = new RequestAuditSession(auditLogger, logger, 'history', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const trend = await scanService.getHistoryTrend({ limit: query.limit });
        response.json(trend);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get(
    '/history/service/:id',
    validateQuery(historyQuerySchema),
    asyncHandler(async (request, response) => {
      const query = request.query as unknown as { limit: number };
      const audit = new RequestAuditSession(auditLogger, logger, 'history', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const history = await scanService.getServiceHistory(
          getSingleValue(request.params.id) ?? '',
          { limit: query.limit },
        );
        response.json(history);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  return router;
}
