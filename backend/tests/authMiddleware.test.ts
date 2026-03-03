import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { authMiddleware, requireRole } from '../src/middleware/authMiddleware.ts';

function createResponseMock() {
  const response = {
    statusCode: 200,
    payload: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.payload = body;
      return this;
    },
  };

  return response as unknown as Response & {
    statusCode: number;
    payload: unknown;
  };
}

function createRequestMock(overrides: Partial<Request> = {}) {
  return {
    headers: {},
    app: {
      locals: {
        authService: {
          verifyAccessToken(token: string) {
            if (token === 'admin-token') {
              return {
                sub: 'user-admin',
                role: 'ADMIN',
                email: 'admin@example.com',
                tenantId: 'tenant-main',
                type: 'access',
              };
            }

            if (token === 'analyst-token') {
              return {
                sub: 'user-analyst',
                role: 'ANALYST',
                email: 'analyst@example.com',
                tenantId: 'tenant-main',
                type: 'access',
              };
            }

            throw new Error(token === 'expired-token' ? 'jwt expired' : 'invalid token');
          },
          getLegacyApiRoleForUser(role: string) {
            if (role === 'ADMIN') return 'ADMIN';
            if (role === 'ANALYST') return 'OPERATOR';
            return 'READER';
          },
        },
      },
    },
    ...overrides,
  } as Request;
}

function createNextMock() {
  let called = false;
  const next: NextFunction = () => {
    called = true;
  };
  return { next, wasCalled: () => called };
}

test('authMiddleware passe avec un accessToken valide et peuple req.user', () => {
  const request = createRequestMock({
    headers: { authorization: 'Bearer admin-token' },
  });
  const response = createResponseMock();
  const { next, wasCalled } = createNextMock();

  authMiddleware(request, response, next);

  assert.equal(wasCalled(), true);
  assert.equal(request.user?.id, 'user-admin');
  assert.equal(request.user?.role, 'ADMIN');
  assert.equal((request as Request & { tenantId?: string }).tenantId, 'tenant-main');
});

test('authMiddleware retourne 401 sans header Authorization', () => {
  const request = createRequestMock();
  const response = createResponseMock();
  const { next, wasCalled } = createNextMock();

  authMiddleware(request, response, next);

  assert.equal(wasCalled(), false);
  assert.equal(response.statusCode, 401);
});

test('authMiddleware retourne 401 avec un token expire', () => {
  const request = createRequestMock({
    headers: { authorization: 'Bearer expired-token' },
  });
  const response = createResponseMock();

  authMiddleware(request, response, () => {});

  assert.equal(response.statusCode, 401);
});

test('authMiddleware retourne 401 avec un token invalide', () => {
  const request = createRequestMock({
    headers: { authorization: 'Bearer invalid-token' },
  });
  const response = createResponseMock();

  authMiddleware(request, response, () => {});

  assert.equal(response.statusCode, 401);
});

test("requireRole('ADMIN') passe pour un admin", () => {
  const request = createRequestMock({
    user: {
      id: 'user-admin',
      role: 'ADMIN',
      email: 'admin@example.com',
      tenantId: 'tenant-main',
    },
  });
  const response = createResponseMock();
  const { next, wasCalled } = createNextMock();

  requireRole('ADMIN')(request, response, next);

  assert.equal(wasCalled(), true);
});

test("requireRole('ADMIN') retourne 403 pour un analyst", () => {
  const request = createRequestMock({
    user: {
      id: 'user-analyst',
      role: 'ANALYST',
      email: 'analyst@example.com',
      tenantId: 'tenant-main',
    },
  });
  const response = createResponseMock();

  requireRole('ADMIN')(request, response, () => {});

  assert.equal(response.statusCode, 403);
});

test("requireRole('ADMIN', 'ANALYST') passe pour un analyst", () => {
  const request = createRequestMock({
    user: {
      id: 'user-analyst',
      role: 'ANALYST',
      email: 'analyst@example.com',
      tenantId: 'tenant-main',
    },
  });
  const response = createResponseMock();
  const { next, wasCalled } = createNextMock();

  requireRole('ADMIN', 'ANALYST')(request, response, next);

  assert.equal(wasCalled(), true);
});
