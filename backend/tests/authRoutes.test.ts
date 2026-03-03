import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import authRoutes from '../src/routes/authRoutes.ts';
import userRoutes from '../src/routes/userRoutes.ts';
import { authMiddleware, requireRole } from '../src/middleware/authMiddleware.ts';
import { AuthServiceError } from '../src/services/authService.ts';
import prisma from '../src/prismaClient.ts';

function createAuthServiceMock() {
  const users = [
    {
      id: 'user-admin',
      tenantId: 'tenant-main',
      email: 'admin@example.com',
      displayName: 'Admin User',
      role: 'ADMIN',
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  let setupNeeded = true;
  let logoutToken: string | null = null;

  return {
    get logoutToken() {
      return logoutToken;
    },
    async needsSetup() {
      return setupNeeded;
    },
    async createFirstAdmin({ email, displayName }: { email: string; password: string; displayName: string }) {
      if (!setupNeeded) {
        throw new AuthServiceError('ADMIN_ALREADY_EXISTS');
      }
      setupNeeded = false;
      return {
        id: 'user-admin',
        tenantId: 'tenant-main',
        email,
        displayName,
        role: 'ADMIN',
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    async login(email: string, password: string) {
      if (email !== 'admin@example.com' || password !== 'Password123!') {
        throw new AuthServiceError('INVALID_CREDENTIALS');
      }
      return {
        accessToken: 'admin-access',
        refreshToken: 'tenant-main.refresh-token',
        user: users[0],
      };
    },
    async refreshTokens(refreshToken: string) {
      if (refreshToken !== 'tenant-main.refresh-token') {
        throw new AuthServiceError('INVALID_REFRESH_TOKEN');
      }
      return {
        accessToken: 'admin-access-refreshed',
        refreshToken: 'tenant-main.refresh-token-next',
      };
    },
    async logout(refreshToken: string) {
      logoutToken = refreshToken;
    },
    async getUserById(userId: string) {
      const user = users.find((entry) => entry.id === userId);
      if (!user) {
        throw new AuthServiceError('USER_NOT_FOUND');
      }
      return user;
    },
    async changePassword(_userId: string, currentPassword: string) {
      if (currentPassword !== 'Password123!') {
        throw new AuthServiceError('INVALID_CURRENT_PASSWORD');
      }
    },
    verifyAccessToken(token: string) {
      if (token === 'admin-access' || token === 'admin-access-refreshed') {
        return {
          sub: 'user-admin',
          role: 'ADMIN',
          email: 'admin@example.com',
          tenantId: 'tenant-main',
          type: 'access',
        };
      }
      if (token === 'viewer-access') {
        return {
          sub: 'user-viewer',
          role: 'VIEWER',
          email: 'viewer@example.com',
          tenantId: 'tenant-main',
          type: 'access',
        };
      }
      throw new Error('invalid token');
    },
    getLegacyApiRoleForUser(role: string) {
      if (role === 'ADMIN') return 'ADMIN';
      if (role === 'ANALYST') return 'OPERATOR';
      return 'READER';
    },
    async getUsers() {
      return users;
    },
  };
}

function createApp() {
  const authService = createAuthServiceMock();
  const app = express();
  app.use(express.json());
  app.locals.authService = authService;
  app.locals.licenseService = {
    getMaxUsers: () => 20,
  };
  app.use('/auth', authRoutes);
  app.use('/users', authMiddleware, requireRole('ADMIN'), userRoutes);
  return { app, authService };
}

async function withServer(app: express.Express, handler: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'string' ? 0 : (address?.port ?? 0);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test.after(async () => {
  await prisma.$disconnect();
});

test('POST /auth/setup cree le premier admin', async () => {
  const { app } = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'Password123!',
        displayName: 'Admin User',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.role, 'ADMIN');
  });
});

test('POST /auth/setup echoue si un admin existe', async () => {
  const { app } = createApp();

  await withServer(app, async (baseUrl) => {
    await fetch(`${baseUrl}/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'Password123!',
        displayName: 'Admin User',
      }),
    });

    const response = await fetch(`${baseUrl}/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'another@example.com',
        password: 'Password123!',
        displayName: 'Another Admin',
      }),
    });

    assert.equal(response.status, 409);
  });
});

test('POST /auth/login retourne des tokens', async () => {
  const { app } = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'Password123!',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.accessToken, 'admin-access');
  });
});

test('POST /auth/login echoue avec mauvais credentials', async () => {
  const { app } = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'wrong',
      }),
    });

    assert.equal(response.status, 401);
  });
});

test('POST /auth/refresh retourne de nouveaux tokens', async () => {
  const { app } = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'tenant-main.refresh-token' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.accessToken, 'admin-access-refreshed');
  });
});

test('POST /auth/logout revoque le token', async () => {
  const { app, authService } = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-access',
      },
      body: JSON.stringify({ refreshToken: 'tenant-main.refresh-token' }),
    });

    assert.equal(response.status, 200);
    assert.equal(authService.logoutToken, 'tenant-main.refresh-token');
  });
});

test('GET /auth/me retourne l utilisateur courant', async () => {
  const { app } = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: 'Bearer admin-access' },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.email, 'admin@example.com');
  });
});

test('routes /users necessitent un admin authentifie', async () => {
  const { app } = createApp();

  await withServer(app, async (baseUrl) => {
    const unauthenticatedResponse = await fetch(`${baseUrl}/users`);
    assert.equal(unauthenticatedResponse.status, 401);

    const forbiddenResponse = await fetch(`${baseUrl}/users`, {
      headers: { Authorization: 'Bearer viewer-access' },
    });
    assert.equal(forbiddenResponse.status, 403);

    const successResponse = await fetch(`${baseUrl}/users`, {
      headers: { Authorization: 'Bearer admin-access' },
    });
    const payload = await successResponse.json();

    assert.equal(successResponse.status, 200);
    assert.equal(payload.users.length, 1);
  });
});
