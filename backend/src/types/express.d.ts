import type { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
        email: string;
        tenantId: string;
      };
    }
  }
}

export {};
