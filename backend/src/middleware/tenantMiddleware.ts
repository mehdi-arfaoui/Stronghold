import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import type { ApiRole } from "@prisma/client";
import prisma from "../prismaClient";

export interface TenantRequest extends Request {
  tenantId?: string;
  apiKeyId?: string;
  apiRole?: ApiRole;
  correlationId?: string;
}

export const tenantMiddleware = async (
  req: TenantRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // laisser passer /health sans auth
    if (req.path === "/health") {
      return next();
    }

    const correlationId = req.header("x-correlation-id") || crypto.randomUUID();
    req.correlationId = correlationId;
    res.setHeader("x-correlation-id", correlationId);

    const startedAt = Date.now();
    const apiKey = req.header("x-api-key");

    if (!apiKey) {
      console.warn("tenantMiddleware: missing x-api-key header");
      return res.status(401).json({ error: "Missing x-api-key header" });
    }

    const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const now = new Date();

    const existingApiKey = await prisma.apiKey.findFirst({
      where: { keyHash: apiKeyHash, revokedAt: null },
    });

    if (existingApiKey?.expiresAt && existingApiKey.expiresAt <= now) {
      req.tenantId = existingApiKey.tenantId;
      return res.status(403).json({ error: "API key expired" });
    }

    const resolvedTenant =
      existingApiKey && (!existingApiKey.expiresAt || existingApiKey.expiresAt > now)
        ? await prisma.tenant.findUnique({ where: { id: existingApiKey.tenantId } })
        : await prisma.tenant.findUnique({ where: { apiKey } });

    if (!resolvedTenant) {
      console.warn("tenantMiddleware: invalid API key provided");
      return res.status(403).json({ error: "Invalid API key" });
    }

    const apiRole: ApiRole = existingApiKey?.role ?? "ADMIN";

    req.tenantId = resolvedTenant.id;
    req.apiKeyId = existingApiKey?.id;
    req.apiRole = apiRole;

    res.on("finish", async () => {
      try {
        if (!req.tenantId) return;
        await prisma.auditLog.create({
          data: {
            tenantId: req.tenantId,
            apiKeyId: req.apiKeyId ?? null,
            path: req.originalUrl || req.path,
            method: req.method,
            statusCode: res.statusCode,
            success: res.statusCode < 400,
            errorCode: res.statusCode >= 400 ? String(res.statusCode) : null,
            latencyMs: Date.now() - startedAt,
            clientIp: req.ip || req.headers["x-forwarded-for"]?.toString() || null,
            userAgent: req.headers["user-agent"] || null,
            correlationId,
          },
        });
        if (existingApiKey) {
          await prisma.apiKey.updateMany({
            where: { id: existingApiKey.id },
            data: { lastUsedAt: new Date() },
          });
        }
      } catch (err) {
        console.warn("Failed to persist audit log", { message: (err as any)?.message });
      }
    });

    next();
  } catch (error) {
    console.error("Error in tenantMiddleware:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const ROLE_RANK: Record<ApiRole, number> = {
  READER: 1,
  OPERATOR: 2,
  ADMIN: 3,
};

function hasSufficientRole(current: ApiRole | undefined, required: ApiRole): boolean {
  if (!current) return false;
  return ROLE_RANK[current] >= ROLE_RANK[required];
}

export function requireRole(required: ApiRole) {
  return (req: TenantRequest, res: Response, next: NextFunction) => {
    const currentRole = req.apiRole;
    if (!hasSufficientRole(currentRole, required)) {
      return res.status(403).json({ error: `Forbidden: ${required} role required` });
    }
    return next();
  };
}
