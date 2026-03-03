import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlanType, PrismaClient, RefreshToken, User, UserRole } from '@prisma/client';
import { AuthService, AuthServiceError } from '../src/services/authService.ts';

type TenantRecord = {
  id: string;
  name: string;
  createdAt: Date;
  license: { plan: PlanType } | null;
};

type Store = {
  tenants: TenantRecord[];
  users: User[];
  refreshTokens: RefreshToken[];
  licenses: Array<{ tenantId: string; plan: PlanType }>;
};

function createStore(): Store {
  return {
    tenants: [
      {
        id: 'tenant-main',
        name: 'Main tenant',
        createdAt: new Date('2026-03-03T08:00:00.000Z'),
        license: { plan: 'PRO' },
      },
    ],
    users: [],
    refreshTokens: [],
    licenses: [],
  };
}

function matchesUserWhere(user: User, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'role' || key === 'tenantId' || key === 'email' || key === 'id') {
      return user[key as keyof User] === value;
    }
    if (key === 'isActive') {
      return user.isActive === value;
    }
    return true;
  });
}

function matchesRefreshWhere(token: RefreshToken, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'tenantId' || key === 'token' || key === 'userId' || key === 'id') {
      return token[key as keyof RefreshToken] === value;
    }
    if (key === 'revokedAt') {
      return value === null ? token.revokedAt === null : token.revokedAt !== null;
    }
    return true;
  });
}

function createPrismaMock(store: Store): PrismaClient {
  const prisma = {
    user: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        store.users.find((user) => matchesUserWhere(user, where)) ?? null,
      findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt: 'asc' | 'desc' } }) => {
        const users = store.users.filter((user) => matchesUserWhere(user, where));
        if (orderBy?.createdAt === 'asc') {
          return [...users].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
        }
        if (orderBy?.createdAt === 'desc') {
          return [...users].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
        return users;
      },
      count: async ({ where }: { where: Record<string, unknown> }) =>
        store.users.filter((user) => matchesUserWhere(user, where)).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const user: User = {
          id: `user-${store.users.length + 1}`,
          tenantId: String(data.tenantId),
          email: String(data.email),
          passwordHash: String(data.passwordHash),
          displayName: String(data.displayName),
          role: data.role as UserRole,
          isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
          lastLoginAt: data.lastLoginAt instanceof Date ? data.lastLoginAt : null,
          createdAt: now,
          updatedAt: now,
        };
        store.users.push(user);
        return user;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const user = store.users.find((entry) => entry.id === where.id);
        if (!user) {
          throw new Error('User not found');
        }
        Object.assign(user, data, { updatedAt: new Date() });
        return user;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = store.users.findIndex((entry) => entry.id === where.id);
        if (index === -1) {
          throw new Error('User not found');
        }
        const [deleted] = store.users.splice(index, 1);
        store.refreshTokens = store.refreshTokens.filter((entry) => entry.userId !== deleted.id);
        return deleted;
      },
    },
    refreshToken: {
      findFirst: async ({
        where,
        include,
      }: {
        where: Record<string, unknown>;
        include?: { user?: boolean };
      }) => {
        const token = store.refreshTokens.find((entry) => matchesRefreshWhere(entry, where));
        if (!token) return null;
        if (include?.user) {
          const user = store.users.find((entry) => entry.id === token.userId);
          return user ? { ...token, user } : null;
        }
        return token;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const token: RefreshToken = {
          id: `rt-${store.refreshTokens.length + 1}`,
          tenantId: String(data.tenantId),
          token: String(data.token),
          userId: String(data.userId),
          expiresAt: data.expiresAt as Date,
          revokedAt: data.revokedAt instanceof Date ? data.revokedAt : null,
          createdAt: new Date(),
        };
        store.refreshTokens.push(token);
        return token;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const token = store.refreshTokens.find((entry) => entry.id === where.id);
        if (!token) {
          throw new Error('Refresh token not found');
        }
        Object.assign(token, data);
        return token;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const token of store.refreshTokens) {
          if (matchesRefreshWhere(token, where)) {
            Object.assign(token, data);
            count += 1;
          }
        }
        return { count };
      },
      deleteMany: async ({
        where,
      }: {
        where: {
          tenantId: string;
          OR?: Array<{ expiresAt?: { lt: Date }; revokedAt?: { not: null } }>;
        };
      }) => {
        const before = store.refreshTokens.length;
        store.refreshTokens = store.refreshTokens.filter((token) => {
          if (token.tenantId !== where.tenantId) return true;
          const shouldDelete = where.OR?.some((condition) => {
            if (condition.expiresAt?.lt) {
              return token.expiresAt < condition.expiresAt.lt;
            }
            if (condition.revokedAt?.not === null) {
              return token.revokedAt !== null;
            }
            return false;
          });
          return !shouldDelete;
        });
        return { count: before - store.refreshTokens.length };
      },
    },
    tenant: {
      findMany: async () => store.tenants,
      create: async ({ data, select }: { data: { name: string; apiKey: string }; select?: { id: true } }) => {
        const tenant: TenantRecord = {
          id: `tenant-${store.tenants.length + 1}`,
          name: data.name,
          createdAt: new Date(),
          license: null,
        };
        store.tenants.push(tenant);
        return select?.id ? { id: tenant.id } : tenant;
      },
    },
    license: {
      upsert: async ({ where, create, update }: { where: { tenantId: string }; create: { tenantId: string; plan: PlanType }; update: { plan: PlanType } }) => {
        const existing = store.licenses.find((entry) => entry.tenantId === where.tenantId);
        if (existing) {
          existing.plan = update.plan;
          return existing;
        }
        const created = { tenantId: create.tenantId, plan: create.plan };
        store.licenses.push(created);
        return created;
      },
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  };

  return prisma as unknown as PrismaClient;
}

function createAuthService(store: Store, maxUsers = 10) {
  process.env.JWT_SECRET = 'a'.repeat(64);
  const prisma = createPrismaMock(store);
  const licenseService = {
    getMaxUsers: () => maxUsers,
    getLicense: () => ({
      lid: 'lic-test',
      company: 'Stronghold Test',
      plan: 'pro',
      maxNodes: 100,
      maxUsers,
      maxCloudEnvs: 2,
      features: ['discovery'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    }),
    getStatus: () => 'valid',
  };

  return new AuthService(prisma, { licenseService: licenseService as any });
}

async function createSeedUser(params: {
  store: Store;
  role?: UserRole;
  email?: string;
  password?: string;
  isActive?: boolean;
}) {
  const service = createAuthService(params.store, 10);
  return service.createUser({
    tenantId: 'tenant-main',
    email: params.email ?? 'user@example.com',
    password: params.password ?? 'Password123!',
    displayName: 'Test User',
    role: params.role ?? 'ANALYST',
  }).then(async (created) => {
    if (params.isActive === false) {
      await service.updateUser(created.id, { isActive: false }, 'tenant-main');
    }
    return created;
  });
}

test('createFirstAdmin cree un admin quand aucun utilisateur n existe', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);

  const admin = await authService.createFirstAdmin({
    email: 'admin@example.com',
    password: 'Password123!',
    displayName: 'Admin',
  });

  assert.equal(admin.role, 'ADMIN');
  assert.equal(store.users.length, 1);
  assert.notEqual(store.users[0]?.passwordHash, 'Password123!');
});

test('createFirstAdmin echoue si un utilisateur existe deja', async () => {
  const store = createStore();
  await createSeedUser({ store, role: 'ADMIN', email: 'admin@example.com' });
  const authService = createAuthService(store, 5);

  await assert.rejects(
    authService.createFirstAdmin({
      email: 'another@example.com',
      password: 'Password123!',
      displayName: 'Another',
    }),
    (error: unknown) => error instanceof AuthServiceError && error.code === 'ADMIN_ALREADY_EXISTS'
  );
});

test('createUser cree un utilisateur avec le bon role et hash le password', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);

  const user = await authService.createUser({
    tenantId: 'tenant-main',
    email: 'analyst@example.com',
    password: 'Password123!',
    displayName: 'Analyst',
    role: 'ANALYST',
  });

  assert.equal(user.role, 'ANALYST');
  assert.equal(store.users[0]?.email, 'analyst@example.com');
  assert.notEqual(store.users[0]?.passwordHash, 'Password123!');
});

test('createUser echoue si la limite maxUsers est atteinte', async () => {
  const store = createStore();
  const authService = createAuthService(store, 1);
  await createSeedUser({ store, role: 'ADMIN', email: 'admin@example.com' });

  await assert.rejects(
    authService.createUser({
      tenantId: 'tenant-main',
      email: 'viewer@example.com',
      password: 'Password123!',
      displayName: 'Viewer',
      role: 'VIEWER',
    }),
    (error: unknown) => error instanceof AuthServiceError && error.code === 'USER_LIMIT_REACHED'
  );
});

test('createUser echoue si email existe deja', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  await createSeedUser({ store, email: 'duplicate@example.com' });

  await assert.rejects(
    authService.createUser({
      tenantId: 'tenant-main',
      email: 'duplicate@example.com',
      password: 'Password123!',
      displayName: 'Duplicate',
      role: 'VIEWER',
    }),
    (error: unknown) => error instanceof AuthServiceError && error.code === 'USER_ALREADY_EXISTS'
  );
});

test('login retourne des tokens pour des credentials valides', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  await createSeedUser({ store, email: 'login@example.com', password: 'Password123!' });

  const result = await authService.login('login@example.com', 'Password123!');

  assert.ok(result.accessToken);
  assert.ok(result.refreshToken.startsWith('tenant-main.'));
  assert.equal(result.user.email, 'login@example.com');
  assert.equal(store.refreshTokens.length, 1);
});

test('login echoue pour un email inexistant', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);

  await assert.rejects(
    authService.login('missing@example.com', 'Password123!'),
    (error: unknown) => error instanceof AuthServiceError && error.code === 'INVALID_CREDENTIALS'
  );
});

test('login echoue pour un mot de passe incorrect', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  await createSeedUser({ store, email: 'login@example.com', password: 'Password123!' });

  await assert.rejects(
    authService.login('login@example.com', 'BadPassword!'),
    (error: unknown) => error instanceof AuthServiceError && error.code === 'INVALID_CREDENTIALS'
  );
});

test('login echoue pour un utilisateur desactive', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  await createSeedUser({
    store,
    email: 'disabled@example.com',
    password: 'Password123!',
    isActive: false,
  });

  await assert.rejects(
    authService.login('disabled@example.com', 'Password123!'),
    (error: unknown) => error instanceof AuthServiceError && error.code === 'INVALID_CREDENTIALS'
  );
});

test('refreshTokens retourne de nouveaux tokens et revoque l ancien', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  await createSeedUser({ store, email: 'refresh@example.com', password: 'Password123!' });
  const loginResult = await authService.login('refresh@example.com', 'Password123!');

  const refreshed = await authService.refreshTokens(loginResult.refreshToken);

  assert.ok(refreshed.accessToken);
  assert.ok(refreshed.refreshToken);
  assert.notEqual(refreshed.refreshToken, loginResult.refreshToken);
  assert.equal(store.refreshTokens[0]?.revokedAt instanceof Date, true);
});

test('refreshTokens echoue avec un token revoque', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  await createSeedUser({ store, email: 'refresh@example.com', password: 'Password123!' });
  const loginResult = await authService.login('refresh@example.com', 'Password123!');
  await authService.logout(loginResult.refreshToken);

  await assert.rejects(
    authService.refreshTokens(loginResult.refreshToken),
    (error: unknown) => error instanceof AuthServiceError && error.code === 'INVALID_REFRESH_TOKEN'
  );
});

test('refreshTokens echoue avec un token expire', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  const user = await createSeedUser({ store, email: 'refresh@example.com', password: 'Password123!' });
  store.refreshTokens.push({
    id: 'expired-token',
    tenantId: 'tenant-main',
    token: 'tenant-main.expired-token',
    userId: user.id,
    expiresAt: new Date(Date.now() - 60_000),
    revokedAt: null,
    createdAt: new Date(),
  });

  await assert.rejects(
    authService.refreshTokens('tenant-main.expired-token'),
    (error: unknown) => error instanceof AuthServiceError && error.code === 'INVALID_REFRESH_TOKEN'
  );
});

test('logout revoque le refresh token', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  await createSeedUser({ store, email: 'logout@example.com', password: 'Password123!' });
  const loginResult = await authService.login('logout@example.com', 'Password123!');

  await authService.logout(loginResult.refreshToken);

  assert.equal(store.refreshTokens[0]?.revokedAt instanceof Date, true);
});

test('logoutAll revoque tous les refresh tokens d un utilisateur', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  const user = await createSeedUser({ store, email: 'multi@example.com', password: 'Password123!' });
  await authService.login('multi@example.com', 'Password123!');
  await authService.login('multi@example.com', 'Password123!');

  await authService.logoutAll(user.id, 'tenant-main');

  assert.ok(store.refreshTokens.every((entry) => entry.revokedAt instanceof Date));
});

test('changePassword fonctionne avec le bon mot de passe actuel', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  const user = await createSeedUser({ store, email: 'password@example.com', password: 'Password123!' });
  await authService.login('password@example.com', 'Password123!');

  await authService.changePassword(user.id, 'Password123!', 'NewPassword123!', 'tenant-main');

  await assert.rejects(
    authService.login('password@example.com', 'Password123!'),
    (error: unknown) => error instanceof AuthServiceError && error.code === 'INVALID_CREDENTIALS'
  );
  const nextLogin = await authService.login('password@example.com', 'NewPassword123!');
  assert.ok(nextLogin.accessToken);
});

test('changePassword echoue avec un mauvais mot de passe actuel', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  const user = await createSeedUser({ store, email: 'password@example.com', password: 'Password123!' });

  await assert.rejects(
    authService.changePassword(user.id, 'WrongPassword!', 'NewPassword123!', 'tenant-main'),
    (error: unknown) => error instanceof AuthServiceError && error.code === 'INVALID_CURRENT_PASSWORD'
  );
});

test('deleteUser empeche la suppression du dernier admin', async () => {
  const store = createStore();
  const authService = createAuthService(store, 5);
  const admin = await createSeedUser({ store, role: 'ADMIN', email: 'admin@example.com' });

  await assert.rejects(
    authService.deleteUser(admin.id, 'tenant-main'),
    (error: unknown) => error instanceof AuthServiceError && error.code === 'LAST_ADMIN_REQUIRED'
  );
});
