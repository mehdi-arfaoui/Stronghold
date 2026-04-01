import { Router } from 'express';
import { redact, redactObject, type Logger } from '@stronghold-dr/core';

import { asyncHandler } from '../middleware/async-handler.js';
import { validateQuery, validateUUIDParam } from '../middleware/validate.js';
import { PrismaAuditLogger } from '../services/prisma-audit-logger.js';
import { RequestAuditSession } from '../services/request-audit.js';
import { ScanService, type ValidationReportFilters } from '../services/scan-service.js';
import { getSingleValue } from '../utils/request-values.js';
import { reportQuerySchema, reportSummaryQuerySchema } from './route-schemas.js';

export function createReportRoutes(
  scanService: ScanService,
  auditLogger: PrismaAuditLogger,
  logger: Logger,
): Router {
  const router = Router();

  router.get(
    '/scans/:scanId/report',
    validateUUIDParam('scanId'),
    validateQuery(reportQuerySchema),
    asyncHandler(async (request, response) => {
      const query = request.query as unknown as {
        format: 'json' | 'markdown';
        category?: ValidationReportFilters['category'];
        severity?: ValidationReportFilters['severity'];
        redact: boolean;
      };
      const flags = query.redact ? ['?redact=true'] : undefined;
      const audit = new RequestAuditSession(auditLogger, logger, 'report', {
        outputFormat: query.format,
        ...(flags ? { flags } : {}),
      });
      await audit.start();

      try {
        const report = await scanService.renderValidationReport(
          getSingleValue(request.params.scanId) ?? '',
          query.format,
          {
            category: query.category,
            severity: query.severity,
          },
        );

        if (query.format === 'markdown') {
          response
            .type('text/markdown')
            .send(query.redact ? redact(report as string) : (report as string));
        } else {
          response.json(query.redact ? redactObject(report) : report);
        }

        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  router.get(
    '/scans/:scanId/report/summary',
    validateUUIDParam('scanId'),
    validateQuery(reportSummaryQuerySchema),
    asyncHandler(async (request, response) => {
      const query = request.query as unknown as { redact: boolean };
      const audit = new RequestAuditSession(auditLogger, logger, 'report', {
        outputFormat: 'summary',
        ...(query.redact ? { flags: ['?redact=true'] } : {}),
      });
      await audit.start();

      try {
        const summary = await scanService.getValidationSummary(
          getSingleValue(request.params.scanId) ?? '',
        );
        response.json(query.redact ? redactObject(summary) : summary);
        await audit.finish({ status: 'success' });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    }),
  );

  return router;
}
