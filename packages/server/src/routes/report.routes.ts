import { Router } from 'express';

import { asyncHandler } from '../middleware/async-handler.js';
import { validateQuery, validateUUIDParam } from '../middleware/validate.js';
import { ScanService, type ValidationReportFilters } from '../services/scan-service.js';
import { getSingleValue } from '../utils/request-values.js';
import { reportQuerySchema } from './route-schemas.js';

export function createReportRoutes(scanService: ScanService): Router {
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
      };
      const report = await scanService.renderValidationReport(
        getSingleValue(request.params.scanId) ?? '',
        query.format,
        {
        category: query.category,
        severity: query.severity,
        },
      );

      if (query.format === 'markdown') {
        response.type('text/markdown').send(report as string);
        return;
      }

      response.json(report);
    }),
  );

  router.get('/scans/:scanId/report/summary', validateUUIDParam('scanId'), asyncHandler(async (request, response) => {
    const summary = await scanService.getValidationSummary(
      getSingleValue(request.params.scanId) ?? '',
    );
    response.json(summary);
  }));

  return router;
}
