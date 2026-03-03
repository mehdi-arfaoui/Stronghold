import { Router, type Response } from 'express';
import type { UserRole } from '@prisma/client';
import { z } from 'zod';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import {
  AuthServiceError,
  type AuthService,
} from '../services/authService.js';

const router = Router();

const createUserSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  displayName: z.string().trim().min(1),
  role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']),
});

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  role: z.enum(['ADMIN', 'ANALYST', 'VIEWER']).optional(),
  isActive: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

function getAuthService(req: TenantRequest): AuthService | null {
  return (req.app.locals.authService as AuthService | undefined) ?? null;
}

function sendAuthError(res: Response, error: unknown) {
  if (!(error instanceof AuthServiceError)) {
    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Erreur interne du serveur.',
    });
  }

  switch (error.code) {
    case 'USER_ALREADY_EXISTS':
      return res.status(409).json({
        error: error.code,
        message: 'Cet email existe deja.',
      });
    case 'USER_LIMIT_REACHED':
      return res.status(403).json({
        error: error.code,
        message: 'Limite maximale utilisateurs atteinte.',
        ...error.details,
      });
    case 'USER_NOT_FOUND':
      return res.status(404).json({
        error: error.code,
        message: 'Utilisateur introuvable.',
      });
    case 'LAST_ADMIN_REQUIRED':
      return res.status(400).json({
        error: error.code,
        message: 'Au moins un administrateur actif doit rester.',
      });
    default:
      return res.status(400).json({
        error: error.code,
        ...error.details,
      });
  }
}

router.get('/', async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  const tenantId = req.user?.tenantId;
  const licenseService = req.app.locals.licenseService;

  if (!authService || !tenantId) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentification requise.',
    });
  }

  try {
    const users = await authService.getUsers(tenantId);
    const count = users.filter((user) => user.isActive).length;
    const maxUsers = typeof licenseService?.getMaxUsers === 'function'
      ? licenseService.getMaxUsers()
      : -1;

    return res.status(200).json({
      users,
      count,
      maxUsers,
    });
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.post('/', async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  const tenantId = req.user?.tenantId;
  if (!authService || !tenantId) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentification requise.',
    });
  }

  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Donnees utilisateur invalides.',
      issues: parsed.error.flatten(),
    });
  }

  try {
    const user = await authService.createUser({
      tenantId,
      ...parsed.data,
      role: parsed.data.role as UserRole,
    });
    return res.status(201).json(user);
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.put('/:id', async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  const currentUser = req.user;
  if (!authService || !currentUser) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentification requise.',
    });
  }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Donnees utilisateur invalides.',
      issues: parsed.error.flatten(),
    });
  }

  if (req.params.id === currentUser.id) {
    if (parsed.data.isActive === false) {
      return res.status(400).json({
        error: 'SELF_DEACTIVATION_FORBIDDEN',
        message: 'Vous ne pouvez pas desactiver votre propre compte.',
      });
    }

    if (parsed.data.role && parsed.data.role !== 'ADMIN') {
      return res.status(400).json({
        error: 'SELF_ROLE_CHANGE_FORBIDDEN',
        message: 'Vous ne pouvez pas retirer votre propre role administrateur.',
      });
    }
  }

  const targetUserId = req.params.id;
  if (!targetUserId) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Identifiant utilisateur manquant.',
    });
  }

  try {
    const user = await authService.updateUser(targetUserId, parsed.data, currentUser.tenantId);
    return res.status(200).json(user);
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.delete('/:id', async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  const currentUser = req.user;
  if (!authService || !currentUser) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentification requise.',
    });
  }

  if (req.params.id === currentUser.id) {
    return res.status(400).json({
      error: 'SELF_DELETE_FORBIDDEN',
      message: 'Vous ne pouvez pas supprimer votre propre compte.',
    });
  }

  const targetUserId = req.params.id;
  if (!targetUserId) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Identifiant utilisateur manquant.',
    });
  }

  try {
    await authService.deleteUser(targetUserId, currentUser.tenantId);
    return res.status(200).json({ success: true });
  } catch (error) {
    return sendAuthError(res, error);
  }
});

router.post('/:id/reset-password', async (req: TenantRequest, res) => {
  const authService = getAuthService(req);
  const currentUser = req.user;
  if (!authService || !currentUser) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentification requise.',
    });
  }

  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Mot de passe invalide.',
      issues: parsed.error.flatten(),
    });
  }

  const targetUserId = req.params.id;
  if (!targetUserId) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Identifiant utilisateur manquant.',
    });
  }

  try {
    await authService.resetPassword(targetUserId, parsed.data.newPassword, currentUser.tenantId);
    return res.status(200).json({ success: true });
  } catch (error) {
    return sendAuthError(res, error);
  }
});

export default router;
