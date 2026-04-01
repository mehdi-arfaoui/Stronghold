import { Router } from 'express';
import type { Logger } from '@stronghold-dr/core';

import { asyncHandler } from '../middleware/async-handler.js';
import { validateBody, validateQuery, validateUUIDParam } from '../middleware/validate.js';
import { PrismaAuditLogger } from '../services/prisma-audit-logger.js';
import { RequestAuditSession } from '../services/request-audit.js';
import { ScanService } from '../services/scan-service.js';
import { getSingleValue } from '../utils/request-values.js';
import { planFormatQuerySchema, planValidateSchema } from './route-schemas.js';

export function createPlanRoutes(
  scanService: ScanService,
  auditLogger: PrismaAuditLogger,
  logger: Logger,
): Router {
  const router = Router();

  router.post(
    '/scans/:scanId/plan/generate',
    validateUUIDParam('scanId'),
    validateQuery(planFormatQuerySchema),
    asyncHandler(async (request, response) => {
      const { format } = request.query as unknown as { format: 'yaml' | 'json' };
      const audit = new RequestAuditSession(auditLogger, logger, 'plan_generate', {
        outputFormat: format,
      });
      await audit.start();

      try {
        const result = await scanService.generatePlan(
          getSingleValue(request.params.scanId) ?? '',
          format,
        );

        if (format === 'yaml') {
          response.type('text/yaml').send(result.content);
        } else {
          response.json(result);
        }

        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get('/scans/:scanId/plan', validateUUIDParam('scanId'), asyncHandler(async (request, response) => {
    const plan = await scanService.getLatestPlan(getSingleValue(request.params.scanId) ?? '');
    response.json(plan);
  }));

  router.post(
    '/plan/validate',
    validateBody(planValidateSchema),
    asyncHandler(async (request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'plan_validate', {});
      await audit.start();

      try {
        const validation = await scanService.validatePlan(
          request.body.planContent,
          request.body.scanId,
        );
        response.json(validation);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  return router;
}
