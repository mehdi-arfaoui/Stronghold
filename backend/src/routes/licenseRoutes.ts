import { Router } from 'express';
import { z } from 'zod';
import type { LicenseService } from '../services/licenseService.js';
import { getLicenseStatusMessage } from '../middleware/licenseMiddleware.js';

const activationSchema = z.object({
  token: z.string().min(1),
});

function resolveLicenseService(router: Router, fallback?: LicenseService) {
  return (router as unknown as { application?: { locals?: { licenseService?: LicenseService } } })
    .application?.locals?.licenseService ?? fallback ?? null;
}

export function createLicenseRoutes(licenseService?: LicenseService) {
  const router = Router();

  router.get('/status', (_req, res) => {
    const service = resolveLicenseService(router, licenseService);
    if (!service) {
      return res.status(500).json({
        status: 'error',
        isOperational: false,
        message: 'License service is not initialized.',
      });
    }

    return res.json(service.toJSON());
  });

  router.post('/activate', async (req, res) => {
    const service = resolveLicenseService(router, licenseService);
    if (!service) {
      return res.status(500).json({
        success: false,
        status: 'error',
        isOperational: false,
        message: 'License service is not initialized.',
      });
    }

    const parsed = activationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        ...service.toJSON(),
        message: 'Le token de licence est requis.',
      });
    }

    const token = parsed.data.token.trim();
    const status = await service.activate(token);
    const payload = service.toJSON();

    if (service.isOperational()) {
      return res.status(200).json({
        success: true,
        ...payload,
      });
    }

    return res.status(400).json({
      success: false,
      ...payload,
      message: getLicenseStatusMessage(status),
    });
  });

  return router;
}

export default createLicenseRoutes();
