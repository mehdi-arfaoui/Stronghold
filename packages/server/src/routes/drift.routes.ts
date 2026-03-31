import { Router } from 'express';

import { asyncHandler } from '../middleware/async-handler.js';
import { validateBody, validateUUIDParam } from '../middleware/validate.js';
import { DriftService } from '../services/drift-service.js';
import { getSingleValue } from '../utils/request-values.js';
import { driftCheckSchema } from './route-schemas.js';

export function createDriftRoutes(driftService: DriftService): Router {
  const router = Router();

  router.post('/drift/check', validateBody(driftCheckSchema), asyncHandler(async (request, response) => {
    const report = await driftService.checkDrift(request.body);
    response.json(report);
  }));

  router.get('/scans/:scanId/drift', validateUUIDParam('scanId'), asyncHandler(async (request, response) => {
    const events = await driftService.listDriftEvents(getSingleValue(request.params.scanId) ?? '');
    response.json({ events });
  }));

  return router;
}
