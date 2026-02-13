import { Router } from "express";
import type { ApiRole } from "@prisma/client";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { authProvisionRateLimit, authRateLimit } from "../middleware/rateLimitMiddleware.js";
import { generateApiKey } from "../services/apiKeyService.js";
import { decryptSecret, encryptSecret } from "../services/secretVaultService.js";
import { appLogger } from "../utils/logger.js";

const router = Router();

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
          lastReviewedAt: true,
          rotatedFromId: true,
          keyCiphertext: true,
          keyRevealedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json(
        keys.map(({ keyCiphertext, ...key }) => ({
          ...key,
          hasVaultedKey: Boolean(keyCiphertext),
        }))
      );
    } catch (error) {
      appLogger.error("Error in GET /auth/api-keys:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/api-keys",
  authProvisionRateLimit,
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
      const encrypted = encryptSecret(raw);

      const created = await prisma.apiKey.create({
        data: {
          tenantId,
          label: label ? String(label).trim() : null,
          keyHash: hash,
          role: parsedRole,
          expiresAt,
          lastReviewedAt: new Date(),
          keyCiphertext: encrypted?.ciphertext ?? null,
          keyIv: encrypted?.iv ?? null,
          keyTag: encrypted?.tag ?? null,
          keyAlgorithm: encrypted?.algorithm ?? null,
        },
      });

      return res.status(201).json({
        id: created.id,
        apiKey: raw,
        role: created.role,
        expiresAt: created.expiresAt,
        label: created.label,
        vaulted: Boolean(encrypted),
      });
    } catch (error) {
      appLogger.error("Error in POST /auth/api-keys:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/api-keys/:id/review",
  authRateLimit,
  requireRole("ADMIN"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      const keyId = String(req.params.id || "");
      if (!keyId) {
        return res.status(400).json({ error: "Missing api key id" });
      }

      const updated = await prisma.apiKey.updateMany({
        where: { id: keyId, tenantId },
        data: { lastReviewedAt: new Date() },
      });

      if (updated.count === 0) {
        return res.status(404).json({ error: "API key introuvable pour ce tenant" });
      }

      const key = await prisma.apiKey.findFirst({
        where: { id: keyId, tenantId },
        select: {
          id: true,
          lastReviewedAt: true,
        },
      });

      return res.status(200).json(key);
    } catch (error) {
      appLogger.error("Error in POST /auth/api-keys/:id/review:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/api-keys/:id/reveal",
  authRateLimit,
  requireRole("ADMIN"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      const keyId = String(req.params.id || "");
      if (!keyId) {
        return res.status(400).json({ error: "Missing api key id" });
      }

      const key = await prisma.apiKey.findFirst({
        where: { id: keyId, tenantId },
        select: {
          id: true,
          keyCiphertext: true,
          keyIv: true,
          keyTag: true,
          keyAlgorithm: true,
        },
      });

      if (!key || !key.keyCiphertext || !key.keyIv || !key.keyTag) {
        return res.status(404).json({ error: "API key non disponible pour révélation" });
      }

      const apiKey = decryptSecret({
        ciphertext: key.keyCiphertext,
        iv: key.keyIv,
        tag: key.keyTag,
        algorithm: "AES-256-GCM",
      });

      await prisma.apiKey.updateMany({
        where: { id: keyId, tenantId },
        data: {
          keyCiphertext: null,
          keyIv: null,
          keyTag: null,
          keyAlgorithm: null,
          keyRevealedAt: new Date(),
        },
      });

      return res.status(200).json({
        id: keyId,
        apiKey,
        revealedAt: new Date(),
      });
    } catch (error) {
      appLogger.error("Error in POST /auth/api-keys/:id/reveal:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/api-keys/rotate",
  authRateLimit,
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
      const encrypted = encryptSecret(raw);

      const created = await prisma.apiKey.create({
        data: {
          tenantId,
          label: label ? String(label).trim() : null,
          keyHash: hash,
          role: parsedRole,
          expiresAt,
          rotatedFromId: req.apiKeyId ?? null,
          lastReviewedAt: new Date(),
          keyCiphertext: encrypted?.ciphertext ?? null,
          keyIv: encrypted?.iv ?? null,
          keyTag: encrypted?.tag ?? null,
          keyAlgorithm: encrypted?.algorithm ?? null,
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
        vaulted: Boolean(encrypted),
      });
    } catch (error) {
      appLogger.error("Error in POST /auth/api-keys/rotate:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
