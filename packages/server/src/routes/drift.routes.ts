import { Router } from 'express';
import type { Logger } from '@stronghold-dr/core';

import { asyncHandler } from '../middleware/async-handler.js';
import { validateBody, validateUUIDParam } from '../middleware/validate.js';
import { PrismaAuditLogger } from '../services/prisma-audit-logger.js';
import { DriftService } from '../services/drift-service.js';
import { RequestAuditSession } from '../services/request-audit.js';
import { getSingleValue } from '../utils/request-values.js';
import { driftCheckSchema } from './route-schemas.js';

export function createDriftRoutes(
  driftService: DriftService,
  auditLogger: PrismaAuditLogger,
  logger: Logger,
): Router {
  const router = Router();

  router.post(
    '/drift/check',
    validateBody(driftCheckSchema),
    asyncHandler(async (request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'drift_check', {});
      await audit.start();

      try {
        const report = await driftService.checkDrift(request.body);
        response.json(report);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get('/scans/:scanId/drift', validateUUIDParam('scanId'), asyncHandler(async (request, response) => {
    const events = await driftService.listDriftEvents(getSingleValue(request.params.scanId) ?? '');
    response.json({ events });
  }));

  return router;
}
