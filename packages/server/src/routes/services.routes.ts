import { Router } from 'express';
import type { Logger } from '@stronghold-dr/core';

import { asyncHandler } from '../middleware/async-handler.js';
import { PrismaAuditLogger } from '../services/prisma-audit-logger.js';
import { RequestAuditSession } from '../services/request-audit.js';
import { ScanService } from '../services/scan-service.js';
import { getSingleValue } from '../utils/request-values.js';

export function createServicesRoutes(
  scanService: ScanService,
  auditLogger: PrismaAuditLogger,
  logger: Logger,
): Router {
  const router = Router();

  router.get(
    '/services',
    asyncHandler(async (_request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'services_list', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const services = await scanService.getLatestServices();
        response.json(services);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get(
    '/services/:id',
    asyncHandler(async (request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'services_show', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const service = await scanService.getServiceDetail(
          getSingleValue(request.params.id) ?? '',
        );
        response.json(service);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get(
    '/services/:id/reasoning',
    asyncHandler(async (request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'services_show', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const reasoning = await scanService.getServiceReasoning(
          getSingleValue(request.params.id) ?? '',
        );
        response.json(reasoning);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.post(
    '/services/detect',
    asyncHandler(async (_request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'services_detect', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const services = await scanService.redetectLatestServices();
        response.json(services);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  return router;
}
