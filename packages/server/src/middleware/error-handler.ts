import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import type { ServerConfig } from '../config/env.js';
import { ServerError } from '../errors/server-error.js';

export function createErrorHandler(config: Pick<ServerConfig, 'nodeEnv'>): ErrorRequestHandler {
  return (error, _request, response, _next) => {
    if (error instanceof ServerError) {
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(config.nodeEnv === 'development' && error.details !== undefined
            ? { details: error.details }
            : {}),
        },
      });
      return;
    }

    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Validation failed',
          ...(config.nodeEnv === 'development' ? { details: error.issues } : {}),
        },
      });
      return;
    }

    if (
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientRustPanicError ||
      error instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      response.status(503).json({
        error: {
          code: 'DB_ERROR',
          message: 'Database request failed',
          ...(config.nodeEnv === 'development' ? { details: error.message } : {}),
        },
      });
      return;
    }

    response.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        ...(config.nodeEnv === 'development'
          ? {
              details: error instanceof Error ? error.message : String(error),
            }
          : {}),
      },
    });
  };
}
