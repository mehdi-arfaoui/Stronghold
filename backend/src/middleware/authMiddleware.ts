import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import type { AuthService } from '../services/authService.js';
import type { TenantRequest } from './tenantMiddleware.js';

function getAuthService(req: Request): AuthService | null {
  return (req.app.locals.authService as AuthService | undefined) ?? null;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const authService = getAuthService(req);

  if (!authService) {
    res.status(500).json({
      error: 'AUTH_SERVICE_UNAVAILABLE',
      message: "Le service d authentification n est pas initialise.",
    });
    return;
  }

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    try {
      const payload = authService.verifyAccessToken(token);
      req.user = {
        id: payload.sub,
        role: payload.role,
        email: payload.email,
        tenantId: payload.tenantId,
      };

      const tenantRequest = req as TenantRequest;
      tenantRequest.tenantId = payload.tenantId;
      tenantRequest.apiRole = authService.getLegacyApiRoleForUser(payload.role);
      next();
      return;
    } catch {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Token invalide ou expire.',
      });
      return;
    }
  }

  if (req.headers['x-api-key']) {
    void import('./tenantMiddleware.js')
      .then(({ tenantMiddleware }) => tenantMiddleware(req as TenantRequest, res, next))
      .catch(() => {
        res.status(500).json({
          error: 'AUTH_FALLBACK_ERROR',
          message: "Impossible d initialiser le fallback x-api-key.",
        });
      });
    return;
  }

  res.status(401).json({
    error: 'UNAUTHORIZED',
    message: "Token d authentification requis.",
  });
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentification requise.',
      });
      return;
    }

    if (!roles.includes(user.role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `Acces reserve aux roles : ${roles.join(', ')}.`,
        requiredRoles: roles,
        currentRole: user.role,
      });
      return;
    }

    next();
  };
}
