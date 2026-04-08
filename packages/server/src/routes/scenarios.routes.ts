import { Router } from 'express';
import type { Logger } from '@stronghold-dr/core';

import { asyncHandler } from '../middleware/async-handler.js';
import { PrismaAuditLogger } from '../services/prisma-audit-logger.js';
import { RequestAuditSession } from '../services/request-audit.js';
import { ScanService } from '../services/scan-service.js';
import { getSingleValue } from '../utils/request-values.js';

export function createScenariosRoutes(
  scanService: ScanService,
  auditLogger: PrismaAuditLogger,
  logger: Logger,
): Router {
  const router = Router();

  router.get(
    '/scenarios',
    asyncHandler(async (_request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'scenarios_list', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const scenarios = await scanService.listScenarios();
        response.json(scenarios);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get(
    '/scenarios/:id',
    asyncHandler(async (request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'scenarios_show', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const scenario = await scanService.getScenarioDetail(
          getSingleValue(request.params.id) ?? '',
        );
        response.json(scenario);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  return router;
}
