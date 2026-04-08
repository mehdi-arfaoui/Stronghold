import { Router } from 'express';
import type { Logger } from '@stronghold-dr/core';

import { asyncHandler } from '../middleware/async-handler.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { evidenceQuerySchema, addEvidenceBodySchema } from './route-schemas.js';
import { PrismaAuditLogger } from '../services/prisma-audit-logger.js';
import { RequestAuditSession } from '../services/request-audit.js';
import { ScanService } from '../services/scan-service.js';

export function createEvidenceRoutes(
  scanService: ScanService,
  auditLogger: PrismaAuditLogger,
  logger: Logger,
): Router {
  const router = Router();

  router.get(
    '/evidence',
    validateQuery(evidenceQuerySchema),
    asyncHandler(async (request, response) => {
      const query = request.query as unknown as { nodeId?: string; serviceId?: string };
      const audit = new RequestAuditSession(auditLogger, logger, 'evidence_list', {
        outputFormat: 'json',
        ...(query.nodeId || query.serviceId
          ? {
              flags: [
                ...(query.nodeId ? [`node:${query.nodeId}`] : []),
                ...(query.serviceId ? [`service:${query.serviceId}`] : []),
              ],
            }
          : {}),
      });
      await audit.start();

      try {
        const payload = await scanService.listEvidence(query);
        response.json(payload);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get(
    '/evidence/expiring',
    asyncHandler(async (_request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'evidence_list', {
        outputFormat: 'json',
        flags: ['expiring'],
      });
      await audit.start();

      try {
        const payload = await scanService.getExpiringEvidence();
        response.json(payload);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.post(
    '/evidence',
    validateBody(addEvidenceBodySchema),
    asyncHandler(async (request, response) => {
      const audit = new RequestAuditSession(auditLogger, logger, 'evidence_add', {
        outputFormat: 'json',
        flags: [
          `node:${request.body.nodeId}`,
          `type:${request.body.type}`,
          `result:${request.body.result}`,
        ],
      });
      await audit.start();

      try {
        const evidence = await scanService.addEvidence(request.body);
        response.status(201).json(evidence);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  return router;
}
