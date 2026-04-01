import { Router } from 'express';
import type { Logger } from '@stronghold-dr/core';

import { ServerError } from '../errors/server-error.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { scanLimiter } from '../middleware/rate-limiter.js';
import { validateBody, validateQuery, validateUUIDParam } from '../middleware/validate.js';
import { PrismaAuditLogger } from '../services/prisma-audit-logger.js';
import { RequestAuditSession } from '../services/request-audit.js';
import { ScanService } from '../services/scan-service.js';
import { getSingleValue } from '../utils/request-values.js';
import { listScansQuerySchema, scanInputSchema } from './route-schemas.js';

export function createScanRoutes(
  scanService: ScanService,
  auditLogger: PrismaAuditLogger,
  logger: Logger,
): Router {
  const router = Router();

  router.post(
    '/',
    scanLimiter,
    validateBody(scanInputSchema),
    asyncHandler(async (request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'scan', {
        regions: request.body.regions,
        ...(request.body.services ? { services: request.body.services } : {}),
      });
      await audit.start();

      try {
        const scanId = await scanService.createScan(request.body);
        response.status(202).json({ scanId, status: 'PENDING' });
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get('/', validateQuery(listScansQuerySchema), asyncHandler(async (request, response) => {
    const result = await scanService.listScans(
      request.query as unknown as { limit: number; cursor?: string },
    );
    response.json(result);
  }));

  router.get('/:id', validateUUIDParam('id'), asyncHandler(async (request, response) => {
    const scan = await scanService.getScanSummary(getSingleValue(request.params.id) ?? '');
    response.json(scan);
  }));

  router.get('/:id/data', validateUUIDParam('id'), asyncHandler(async (request, response) => {
    const scanData = await scanService.getScanData(getSingleValue(request.params.id) ?? '');
    response.json(scanData);
  }));

  router.delete('/:id', validateUUIDParam('id'), asyncHandler(async (request, response) => {
    const deleted = await scanService.deleteScan(getSingleValue(request.params.id) ?? '');
    if (!deleted) {
      throw new ServerError('Scan not found', { code: 'SCAN_NOT_FOUND', status: 404 });
    }

    response.status(204).send();
  }));

  return router;
}
