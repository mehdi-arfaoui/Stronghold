import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import prisma from "../../prismaClient.js";
import { tenantMiddleware, type TenantRequest } from "../../middleware/tenantMiddleware.js";

type MockOverrides = {
  apiKeyFindFirst?: (...args: any[]) => Promise<any>;
  tenantFindUnique?: (...args: any[]) => Promise<any>;
  auditLogCreate?: (...args: any[]) => Promise<any>;
  apiKeyUpdateMany?: (...args: any[]) => Promise<any>;
};

const prismaMutable = prisma as any;
const originalApiKeyFindFirst = prismaMutable.apiKey.findFirst.bind(prismaMutable.apiKey);
const originalTenantFindUnique = prismaMutable.tenant.findUnique.bind(prismaMutable.tenant);
const originalAuditLogCreate = prismaMutable.auditLog.create.bind(prismaMutable.auditLog);
const originalApiKeyUpdateMany = prismaMutable.apiKey.updateMany.bind(prismaMutable.apiKey);

function setPrismaMocks(overrides: MockOverrides) {
  prismaMutable.apiKey.findFirst = overrides.apiKeyFindFirst || originalApiKeyFindFirst;
  prismaMutable.tenant.findUnique = overrides.tenantFindUnique || originalTenantFindUnique;
  prismaMutable.auditLog.create = overrides.auditLogCreate || originalAuditLogCreate;
  prismaMutable.apiKey.updateMany = overrides.apiKeyUpdateMany || originalApiKeyUpdateMany;
}

function resetPrismaMocks() {
  prismaMutable.apiKey.findFirst = originalApiKeyFindFirst;
  prismaMutable.tenant.findUnique = originalTenantFindUnique;
  prismaMutable.auditLog.create = originalAuditLogCreate;
  prismaMutable.apiKey.updateMany = originalApiKeyUpdateMany;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    void tenantMiddleware(req as TenantRequest, res, next);
  });
  app.get("/protected", (req, res) => {
    res.status(200).json({ tenantId: (req as TenantRequest).tenantId || null });
  });
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  return app;
}

async function withServer(
  app: express.Express,
  handler: (baseUrl: string) => Promise<void>
) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const address = server.address();
  const port = typeof address === "string" ? 0 : (address?.port ?? 0);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("protected endpoint without API key returns 401", { concurrency: false }, async () => {
  setPrismaMocks({
    apiKeyFindFirst: async () => null,
    tenantFindUnique: async () => null,
    auditLogCreate: async () => ({}),
    apiKeyUpdateMany: async () => ({ count: 0 }),
  });

  const app = createApp();
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`);
      assert.equal(response.status, 401);
    });
  } finally {
    resetPrismaMocks();
  }
});

test("malformed/invalid API key returns 403", { concurrency: false }, async () => {
  setPrismaMocks({
    apiKeyFindFirst: async () => null,
    tenantFindUnique: async () => null,
    auditLogCreate: async () => ({}),
    apiKeyUpdateMany: async () => ({ count: 0 }),
  });

  const app = createApp();
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: { "x-api-key": "bad-token-format" },
      });
      assert.equal(response.status, 403);
    });
  } finally {
    resetPrismaMocks();
  }
});

test("expired API key returns 403", { concurrency: false }, async () => {
  setPrismaMocks({
    apiKeyFindFirst: async () => ({
      id: "expired_key",
      tenantId: "tenant-expired",
      expiresAt: new Date(Date.now() - 60_000),
      revokedAt: null,
      role: "ADMIN",
    }),
    tenantFindUnique: async () => null,
    auditLogCreate: async () => ({}),
    apiKeyUpdateMany: async () => ({ count: 0 }),
  });

  const app = createApp();
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: { "x-api-key": "expired-key" },
      });
      assert.equal(response.status, 403);
    });
  } finally {
    resetPrismaMocks();
  }
});

test("valid API key allows protected access", { concurrency: false }, async () => {
  setPrismaMocks({
    apiKeyFindFirst: async () => ({
      id: "valid_key_id",
      tenantId: "tenant-a",
      expiresAt: null,
      revokedAt: null,
      role: "ADMIN",
    }),
    tenantFindUnique: async ({ where }: any) => {
      if (where?.id === "tenant-a") return { id: "tenant-a" };
      return null;
    },
    auditLogCreate: async () => ({}),
    apiKeyUpdateMany: async () => ({ count: 1 }),
  });

  const app = createApp();
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: { "x-api-key": "valid-key" },
      });
      assert.equal(response.status, 200);
      const payload = (await response.json()) as { tenantId: string | null };
      assert.equal(payload.tenantId, "tenant-a");
    });
  } finally {
    resetPrismaMocks();
  }
});

test("health endpoint remains public", { concurrency: false }, async () => {
  const app = createApp();
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
  });
});
