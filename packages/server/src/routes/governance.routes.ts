import { Router } from 'express';
import type { Logger } from '@stronghold-dr/core';

import { asyncHandler } from '../middleware/async-handler.js';
import { PrismaAuditLogger } from '../services/prisma-audit-logger.js';
import { RequestAuditSession } from '../services/request-audit.js';
import { ScanService } from '../services/scan-service.js';

export function createGovernanceRoutes(
  scanService: ScanService,
  auditLogger: PrismaAuditLogger,
  logger: Logger,
): Router {
  const router = Router();

  router.get(
    '/governance',
    asyncHandler(async (_request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'governance', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const governance = await scanService.getLatestGovernance();
        response.json(governance);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get(
    '/governance/acceptances',
    asyncHandler(async (_request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'governance', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const acceptances = await scanService.listGovernanceAcceptances();
        response.json(acceptances);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get(
    '/governance/policies',
    asyncHandler(async (_request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'governance', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        const policies = await scanService.listGovernancePolicies();
        response.json(policies);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.post(
    '/governance/accept',
    asyncHandler(async (_request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'risk_accept', {
        outputFormat: 'json',
      });
      await audit.start();

      try {
        await scanService.acceptGovernanceRisk();
        response.status(201).json({});
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  return router;
}
