import type { RequestHandler } from 'express';

import type { Logger } from '@stronghold-dr/core';

export function createRequestLogger(logger: Logger): RequestHandler {
  return (request, response, next): void => {
    const startedAt = Date.now();

    response.on('finish', () => {
      logger.info('request.completed', {
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  };
}
