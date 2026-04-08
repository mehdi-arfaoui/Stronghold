import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

import { asyncHandler } from '../middleware/async-handler.js';

export function createHealthRoutes(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      version: '1.0.0',
      uptime: process.uptime(),
    });
  });

  router.get('/health/db', asyncHandler(async (_request, response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      response.json({ status: 'ok' });
    } catch (error) {
      response.status(503).json({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }));

  return router;
}
