import type { NextFunction, Request, Response } from "express";
import { buildValidationError } from "../validation/common.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function hasForbiddenKeys(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenKeys(item));
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) {
      return true;
    }
    if (hasForbiddenKeys(nestedValue)) {
      return true;
    }
  }

  return false;
}

export function requestValidationGuard(req: Request, res: Response, next: NextFunction) {
  if (!req.is("application/json")) {
    return next();
  }

  if (req.body === undefined || req.body === null) {
    return next();
  }

  if (typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json(
      buildValidationError([
        {
          field: "body",
          message: "doit être un objet JSON",
        },
      ])
    );
  }

  if (hasForbiddenKeys(req.body)) {
    return res.status(400).json(
      buildValidationError([
        {
          field: "body",
          message: "contient des clés interdites",
        },
      ])
    );
  }

  return next();
}
