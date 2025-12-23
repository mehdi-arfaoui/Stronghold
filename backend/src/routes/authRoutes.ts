import { Router } from "express";
import crypto from "crypto";
import type { ApiRole } from "@prisma/client";
import prisma from "../prismaClient";
import { TenantRequest, requireRole } from "../middleware/tenantMiddleware";

const router = Router();

function generateApiKey(): { raw: string; hash: string } {
  const raw = `sk_${crypto.randomBytes(32).toString("hex")}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

function parseRole(input: any): ApiRole {
  const normalized = String(input || "").toUpperCase();
  if (normalized === "ADMIN") return "ADMIN";
  if (normalized === "READER") return "READER";
  return "OPERATOR";
}

function computeExpiry(days?: any): Date | null {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  const expires = new Date();
  expires.setDate(expires.getDate() + Math.floor(n));
  return expires;
}

router.get(
  "/api-keys",
  requireRole("ADMIN"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      const keys = await prisma.apiKey.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          label: true,
          role: true,
          expiresAt: true,
          revokedAt: true,
          lastUsedAt: true,
          rotatedFromId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json(keys);
    } catch (error) {
      console.error("Error in GET /auth/api-keys:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/api-keys",
  requireRole("ADMIN"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      const { label, role, expiresInDays } = req.body || {};
      const { raw, hash } = generateApiKey();
      const expiresAt = computeExpiry(expiresInDays);
      const parsedRole = parseRole(role);

      const created = await prisma.apiKey.create({
        data: {
          tenantId,
          label: label ? String(label).trim() : null,
          keyHash: hash,
          role: parsedRole,
          expiresAt,
        },
      });

      return res.status(201).json({
        id: created.id,
        apiKey: raw,
        role: created.role,
        expiresAt: created.expiresAt,
        label: created.label,
      });
    } catch (error) {
      console.error("Error in POST /auth/api-keys:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/api-keys/rotate",
  requireRole("ADMIN"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      const { label, expiresInDays, role } = req.body || {};
      const { raw, hash } = generateApiKey();
      const expiresAt = computeExpiry(expiresInDays);
      const parsedRole = parseRole(role || req.apiRole || "OPERATOR");

      const created = await prisma.apiKey.create({
        data: {
          tenantId,
          label: label ? String(label).trim() : null,
          keyHash: hash,
          role: parsedRole,
          expiresAt,
          rotatedFromId: req.apiKeyId ?? null,
        },
      });

      if (req.apiKeyId) {
        await prisma.apiKey.updateMany({
          where: { id: req.apiKeyId, tenantId },
          data: { revokedAt: new Date() },
        });
      }

      return res.status(201).json({
        id: created.id,
        apiKey: raw,
        role: created.role,
        expiresAt: created.expiresAt,
        rotatedFromId: req.apiKeyId ?? null,
      });
    } catch (error) {
      console.error("Error in POST /auth/api-keys/rotate:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
