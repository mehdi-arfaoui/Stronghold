import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";

function isHealthOrMetricsPath(req: Request): boolean {
  const path = req.path || req.originalUrl || "";
  return path === "/health" || path.startsWith("/health/") || path === "/metrics";
}

function buildLimiter(windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: isHealthOrMetricsPath,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: "Too many requests, please try again later.",
      });
    },
  });
}

function normalizeNodeEnv(nodeEnv: string | undefined): string {
  return nodeEnv?.trim().toLowerCase() || "production";
}

export function resolveLoginRateLimitPolicy(nodeEnv = process.env.NODE_ENV): {
  windowMs: number;
  limit: number;
} {
  if (normalizeNodeEnv(nodeEnv) === "development") {
    return {
      windowMs: 60_000,
      limit: 100,
    };
  }

  return {
    windowMs: 60_000,
    limit: 20,
  };
}

export function createLoginRateLimit(nodeEnv = process.env.NODE_ENV) {
  const policy = resolveLoginRateLimitPolicy(nodeEnv);
  return buildLimiter(policy.windowMs, policy.limit);
}

export const globalRateLimitShort = buildLimiter(1_000, 10);
export const globalRateLimitMedium = buildLimiter(60_000, 100);
export const globalRateLimitLong = buildLimiter(3_600_000, 1_000);

export const loginRateLimit = createLoginRateLimit();
export const authRateLimit = buildLimiter(60_000, 5);
export const authProvisionRateLimit = buildLimiter(3_600_000, 3);
export const scanRateLimit = buildLimiter(3_600_000, 10);
export const reportRateLimit = buildLimiter(3_600_000, 10);
