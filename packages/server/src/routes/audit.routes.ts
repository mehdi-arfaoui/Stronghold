import { Router } from 'express';

import { asyncHandler } from '../middleware/async-handler.js';
import { validateQuery } from '../middleware/validate.js';
import { PrismaAuditLogger } from '../services/prisma-audit-logger.js';
import { listScansQuerySchema } from './route-schemas.js';

export function createAuditRoutes(auditLogger: PrismaAuditLogger): Router {
  const router = Router();

  router.get(
    '/audit',
    validateQuery(listScansQuerySchema),
    asyncHandler(async (request, response) => {
      const result = await auditLogger.list(
        request.query as unknown as { limit: number; cursor?: string },
      );
      response.json(result);
    }),
  );

  return router;
}
