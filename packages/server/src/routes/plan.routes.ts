import { Router } from 'express';

import { asyncHandler } from '../middleware/async-handler.js';
import { validateBody, validateQuery, validateUUIDParam } from '../middleware/validate.js';
import { ScanService } from '../services/scan-service.js';
import { getSingleValue } from '../utils/request-values.js';
import { planFormatQuerySchema, planValidateSchema } from './route-schemas.js';

export function createPlanRoutes(scanService: ScanService): Router {
  const router = Router();

  router.post(
    '/scans/:scanId/plan/generate',
    validateUUIDParam('scanId'),
    validateQuery(planFormatQuerySchema),
    asyncHandler(async (request, response) => {
      const { format } = request.query as unknown as { format: 'yaml' | 'json' };
      const result = await scanService.generatePlan(
        getSingleValue(request.params.scanId) ?? '',
        format,
      );

      if (format === 'yaml') {
        response.type('text/yaml').send(result.content);
        return;
      }

      response.json(result);
    }),
  );

  router.get('/scans/:scanId/plan', validateUUIDParam('scanId'), asyncHandler(async (request, response) => {
    const plan = await scanService.getLatestPlan(getSingleValue(request.params.scanId) ?? '');
    response.json(plan);
  }));

  router.post('/plan/validate', validateBody(planValidateSchema), asyncHandler(async (request, response) => {
    const validation = await scanService.validatePlan(request.body.planContent, request.body.scanId);
    response.json(validation);
  }));

  return router;
}
