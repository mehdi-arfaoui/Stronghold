import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';

import { getSingleValue } from '../utils/request-values.js';
import { isValidUUID } from '../utils/uuid.js';

function buildValidationResponse(details?: unknown): { error: { code: string; message: string; details?: unknown } } {
  return {
    error: {
      code: 'INVALID_INPUT',
      message: 'Validation failed',
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      response.status(400).json(buildValidationResponse(result.error.issues));
      return;
    }

    request.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodTypeAny): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      response.status(400).json(buildValidationResponse(result.error.issues));
      return;
    }

    request.query = result.data;
    next();
  };
}

export function validateUUIDParam(paramName: string): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const value = getSingleValue(request.params[paramName]);
    if (!value || !isValidUUID(value)) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: `Invalid ${paramName}: must be a valid UUID`,
        },
      });
      return;
    }

    next();
  };
}
