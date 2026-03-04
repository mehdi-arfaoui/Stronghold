import { Router, type Response } from 'express';
import type { ApiRole } from '@prisma/client';
import { z } from 'zod';
import prisma from '../prismaClient.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireRole as requireLegacyRole } from '../middleware/tenantMiddleware.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { authProvisionRateLimit, authRateLimit, loginRateLimit } from '../middleware/rateLimitMiddleware.js';
import { generateApiKey } from '../services/apiKeyService.js';
import {
  AuthServiceError,
  type AuthService,
} from '../services/authService.js';
import { decryptSecret, encryptSecret } from '../services/secretVaultService.js';
import { appLogger } from '../utils/logger.js';

const router = Router();

const setupSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  displayName: z.string().trim().min(1),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().trim().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

function getAuthService(req: TenantRequest): AuthService | null {
  return (req.app.locals.authService as AuthService | undefined) ?? null;
}

function parseRole(input: unknown): ApiRole {
  const normalized = String(input || '').toUpperCase();
  if (normalized === 'ADMIN') return 'ADMIN';
  if (normalized === 'READER') return 'READER';
  return 'OPERATOR';
}

function computeExpiry(days?: unknown): Date | null {
  const parsedDays = Number(days);
  if (!Number.isFinite(parsedDays) || parsedDays <= 0) return null;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + Math.floor(parsedDays));
  return expiresAt;
}

function sendAuthError(res: Response, error: unknown) {
  if (!(error instanceof AuthServiceError)) {
    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Erreur interne du serveur.',
    });
  }

  const details = error.details ?? {};
  switch (error.code) {
    case 'ADMIN_ALREADY_EXISTS':
      return res.status(409).json({
        error: error.code,
        message: 'Le compte administrateur initial existe deja.',
      });
    case 'INVALID_CREDENTIALS':
      return res.status(401).json({
        error: error.code,
        message: 'Identifiants invalides.',
      });
    case 'INVALID_REFRESH_TOKEN':
      return res.status(401).json({
        error: error.code,
        message: 'Refresh token invalide ou expire.',
      });
    case 'INVALID_CURRENT_PASSWORD':
      return res.status(400).json({
        error: error.code,
        message: 'Mot de passe actuel invalide.',
      });
    case 'USER_NOT_FOUND':
      return res.status(404).json({
        error: error.code,
        message: 'Utilisateur introuvable.',
      });
    case 'TENANT_RESOLUTION_ERROR':
      return res.status(409).json({
        error: error.code,
        message: "Impossible de resoudre le tenant de l installation.",
        ...details,
      });
    default:
      return res.status(400).json({
        error: error.code,
        ...details,
      });
  }
}

router.get('/setup-status', async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  if (!authService) {
    return res.status(500).json({
      error: 'AUTH_SERVICE_UNAVAILABLE',
      message: "Le service d authentification n est pas initialise.",
    });
  }

  try {
    const needsSetup = await authService.needsSetup();
    return res.status(200).json({ needsSetup });
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.post('/setup', authProvisionRateLimit, async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  if (!authService) {
    return res.status(500).json({
      error: 'AUTH_SERVICE_UNAVAILABLE',
      message: "Le service d authentification n est pas initialise.",
    });
  }

  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Donnees de creation administrateur invalides.',
      issues: parsed.error.flatten(),
    });
  }

  try {
    const user = await authService.createFirstAdmin(parsed.data);
    return res.status(201).json(user);
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.post('/login', loginRateLimit, async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  if (!authService) {
    return res.status(500).json({
      error: 'AUTH_SERVICE_UNAVAILABLE',
      message: "Le service d authentification n est pas initialise.",
    });
  }

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Email et mot de passe requis.',
      issues: parsed.error.flatten(),
    });
  }

  try {
    const payload = await authService.login(parsed.data.email, parsed.data.password);
    return res.status(200).json(payload);
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.post('/refresh', authRateLimit, async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  if (!authService) {
    return res.status(500).json({
      error: 'AUTH_SERVICE_UNAVAILABLE',
      message: "Le service d authentification n est pas initialise.",
    });
  }

  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Refresh token requis.',
      issues: parsed.error.flatten(),
    });
  }

  try {
    const tokens = await authService.refreshTokens(parsed.data.refreshToken);
    return res.status(200).json(tokens);
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.post('/logout', authMiddleware, async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  if (!authService) {
    return res.status(500).json({
      error: 'AUTH_SERVICE_UNAVAILABLE',
      message: "Le service d authentification n est pas initialise.",
    });
  }

  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Refresh token requis.',
      issues: parsed.error.flatten(),
    });
  }

  await authService.logout(parsed.data.refreshToken);
  return res.status(200).json({ success: true });
});

router.get('/me', authMiddleware, async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  if (!authService || !req.user) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentification requise.',
    });
  }

  try {
    const user = await authService.getUserById(req.user.id, req.user.tenantId);
    return res.status(200).json(user);
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.put('/me/password', authMiddleware, async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  if (!authService || !req.user) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentification requise.',
    });
  }

  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Mot de passe invalide.',
      issues: parsed.error.flatten(),
    });
  }

  try {
    await authService.changePassword(
      req.user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      req.user.tenantId
    );
    return res.status(200).json({ success: true });
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.get(
  '/api-keys',
  authMiddleware,
  requireLegacyRole('ADMIN'),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: 'Tenant not resolved' });
      }

      const keys = await prisma.apiKey.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
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
      appLogger.error('Error in GET /auth/api-keys:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/api-keys',
  authProvisionRateLimit,
  authMiddleware,
  requireLegacyRole('ADMIN'),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: 'Tenant not resolved' });
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
      appLogger.error('Error in POST /auth/api-keys:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/api-keys/:id/review',
  authRateLimit,
  authMiddleware,
  requireLegacyRole('ADMIN'),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: 'Tenant not resolved' });
      }

      const keyId = String(req.params.id || '');
      if (!keyId) {
        return res.status(400).json({ error: 'Missing api key id' });
      }

      const updated = await prisma.apiKey.updateMany({
        where: { id: keyId, tenantId },
        data: { lastReviewedAt: new Date() },
      });

      if (updated.count === 0) {
        return res.status(404).json({ error: 'API key introuvable pour ce tenant' });
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
      appLogger.error('Error in POST /auth/api-keys/:id/review:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/api-keys/:id/reveal',
  authRateLimit,
  authMiddleware,
  requireLegacyRole('ADMIN'),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: 'Tenant not resolved' });
      }

      const keyId = String(req.params.id || '');
      if (!keyId) {
        return res.status(400).json({ error: 'Missing api key id' });
      }

      const key = await prisma.apiKey.findFirst({
        where: { id: keyId, tenantId },
        select: {
          id: true,
          keyCiphertext: true,
          keyIv: true,
          keyTag: true,
        },
      });

      if (!key || !key.keyCiphertext || !key.keyIv || !key.keyTag) {
        return res.status(404).json({ error: 'API key non disponible pour revelation' });
      }

      const apiKey = decryptSecret({
        ciphertext: key.keyCiphertext,
        iv: key.keyIv,
        tag: key.keyTag,
        algorithm: 'AES-256-GCM',
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
      appLogger.error('Error in POST /auth/api-keys/:id/reveal:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/api-keys/rotate',
  authRateLimit,
  authMiddleware,
  requireLegacyRole('ADMIN'),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: 'Tenant not resolved' });
      }

      const { label, expiresInDays, role } = req.body || {};
      const { raw, hash } = generateApiKey();
      const expiresAt = computeExpiry(expiresInDays);
      const parsedRole = parseRole(role || req.apiRole || 'OPERATOR');
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
      appLogger.error('Error in POST /auth/api-keys/rotate:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
