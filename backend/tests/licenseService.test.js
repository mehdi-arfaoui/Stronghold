const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const { getOrCreateDelegate } = require("./testUtils");

const {
  LicenseService,
  LicenseNotFoundError,
} = require("../src/services/licenseService.ts");
const prismaModule = require("../src/prismaClient.ts");
const prisma = prismaModule.default ?? prismaModule;
const redisModule = require("../src/lib/redis.ts");
const redis = redisModule.redis ?? redisModule.default;

// Helper to create a mock license
const createMockLicense = (overrides = {}) => ({
  id: "lic_123",
  tenantId: "tenant_abc",
  plan: "PRO",
  status: "ACTIVE",
  maxUsers: 25,
  maxStorage: BigInt(10737418240),
  maxScansMonth: 1000,
  maxDocuments: 5000,
  features: ["discovery", "bia", "pra"],
  startsAt: new Date(),
  expiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  usage: {
    id: "usage_123",
    licenseId: "lic_123",
    currentUsers: 10,
    currentStorage: BigInt(1073741824),
    scansThisMonth: 50,
    documentsCount: 100,
    lastResetAt: new Date(),
    updatedAt: new Date(),
  },
  ...overrides,
});

test("LicenseService.getLicense returns cached license if available", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense();

  const originalGet = redis.get;
  redis.get = async () => JSON.stringify(mockLicense);

  t.after(() => {
    redis.get = originalGet;
  });

  const result = await service.getLicense("tenant_abc");

  assert.equal(result.tenantId, "tenant_abc");
  assert.equal(result.plan, "PRO");
});

test("LicenseService.getLicense fetches from DB and caches if not cached", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense();

  const licenseDelegate = getOrCreateDelegate(prisma, "license");
  const originalFindUnique = licenseDelegate.findUnique;
  const originalGet = redis.get;
  const originalSetex = redis.setex;

  let setexCalled = false;

  redis.get = async () => null;
  redis.setex = async () => {
    setexCalled = true;
    return "OK";
  };
  licenseDelegate.findUnique = async () => mockLicense;

  t.after(() => {
    redis.get = originalGet;
    redis.setex = originalSetex;
    licenseDelegate.findUnique = originalFindUnique;
  });

  const result = await service.getLicense("tenant_abc");

  assert.equal(result.tenantId, "tenant_abc");
  assert.ok(setexCalled, "setex should have been called to cache the result");
});

test("LicenseService.getLicense throws LicenseNotFoundError if no license", async (t) => {
  const service = new LicenseService();

  const licenseDelegate = getOrCreateDelegate(prisma, "license");
  const originalFindUnique = licenseDelegate.findUnique;
  const originalGet = redis.get;

  redis.get = async () => null;
  licenseDelegate.findUnique = async () => null;

  t.after(() => {
    redis.get = originalGet;
    licenseDelegate.findUnique = originalFindUnique;
  });

  await assert.rejects(
    () => service.getLicense("unknown"),
    (error) => error instanceof LicenseNotFoundError
  );
});

test("LicenseService.hasFeature returns true if feature is in list", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense();

  const originalGet = redis.get;
  redis.get = async () => JSON.stringify(mockLicense);

  t.after(() => {
    redis.get = originalGet;
  });

  const result = await service.hasFeature("tenant_abc", "bia");

  assert.equal(result, true);
});

test("LicenseService.hasFeature returns false if feature not in list", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense();

  const originalGet = redis.get;
  redis.get = async () => JSON.stringify(mockLicense);

  t.after(() => {
    redis.get = originalGet;
  });

  const result = await service.hasFeature("tenant_abc", "exercises");

  assert.equal(result, false);
});

test("LicenseService.hasFeature returns true for any feature if wildcard", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense({ features: ["*"] });

  const originalGet = redis.get;
  redis.get = async () => JSON.stringify(mockLicense);

  t.after(() => {
    redis.get = originalGet;
  });

  const result = await service.hasFeature("tenant_abc", "anything");

  assert.equal(result, true);
});

test("LicenseService.hasFeature returns false if license not active", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense({ status: "SUSPENDED" });

  const originalGet = redis.get;
  redis.get = async () => JSON.stringify(mockLicense);

  t.after(() => {
    redis.get = originalGet;
  });

  const result = await service.hasFeature("tenant_abc", "bia");

  assert.equal(result, false);
});

test("LicenseService.checkQuota allows if under quota", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense();

  const originalGet = redis.get;
  redis.get = async () => JSON.stringify(mockLicense);

  t.after(() => {
    redis.get = originalGet;
  });

  const result = await service.checkQuota("tenant_abc", "users", 1);

  assert.equal(result.allowed, true);
  assert.equal(result.current, 10);
  assert.equal(result.max, 25);
  assert.equal(result.remaining, 15);
});

test("LicenseService.checkQuota denies if over quota", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense();

  const originalGet = redis.get;
  redis.get = async () => JSON.stringify(mockLicense);

  t.after(() => {
    redis.get = originalGet;
  });

  const result = await service.checkQuota("tenant_abc", "users", 20);

  assert.equal(result.allowed, false);
});

test("LicenseService.checkQuota always allows if max is -1 (unlimited)", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense({ maxUsers: -1 });

  const originalGet = redis.get;
  redis.get = async () => JSON.stringify(mockLicense);

  t.after(() => {
    redis.get = originalGet;
  });

  const result = await service.checkQuota("tenant_abc", "users", 1000);

  assert.equal(result.allowed, true);
  assert.equal(result.remaining, Infinity);
});

test("LicenseService.isValid returns valid for active license", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense();

  const originalGet = redis.get;
  redis.get = async () => JSON.stringify(mockLicense);

  t.after(() => {
    redis.get = originalGet;
  });

  const result = await service.isValid("tenant_abc");

  assert.equal(result.valid, true);
});

test("LicenseService.isValid returns invalid for suspended license", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense({ status: "SUSPENDED" });

  const originalGet = redis.get;
  redis.get = async () => JSON.stringify(mockLicense);

  t.after(() => {
    redis.get = originalGet;
  });

  const result = await service.isValid("tenant_abc");

  assert.equal(result.valid, false);
  assert.equal(result.reason, "License suspended");
});

test("LicenseService.isValid returns invalid for expired license", async (t) => {
  const service = new LicenseService();
  const mockLicense = createMockLicense({
    expiresAt: new Date("2020-01-01").toISOString(),
  });

  const licenseDelegate = getOrCreateDelegate(prisma, "license");
  const originalUpdate = licenseDelegate.update;
  const originalGet = redis.get;
  const originalDel = redis.del;

  redis.get = async () => JSON.stringify(mockLicense);
  redis.del = async () => 1;
  licenseDelegate.update = async () => ({});

  t.after(() => {
    redis.get = originalGet;
    redis.del = originalDel;
    licenseDelegate.update = originalUpdate;
  });

  const result = await service.isValid("tenant_abc");

  assert.equal(result.valid, false);
  assert.equal(result.reason, "License expired");
});

test("LicenseService.createLicense creates a license with default plan", async (t) => {
  const service = new LicenseService();

  const licenseDelegate = getOrCreateDelegate(prisma, "license");
  const originalCreate = licenseDelegate.create;

  let createData = null;
  licenseDelegate.create = async ({ data }) => {
    createData = data;
    return {
      id: "lic_new",
      ...data,
      usage: { id: "usage_new" },
    };
  };

  t.after(() => {
    licenseDelegate.create = originalCreate;
  });

  const result = await service.createLicense("tenant_xyz", "STARTER");

  assert.equal(createData.tenantId, "tenant_xyz");
  assert.equal(createData.plan, "STARTER");
  assert.equal(createData.maxUsers, 5);
  assert.ok(createData.features.includes("discovery"));
});

test("LicenseService.upgradePlan updates plan and invalidates cache", async (t) => {
  const service = new LicenseService();

  const licenseDelegate = getOrCreateDelegate(prisma, "license");
  const originalUpdate = licenseDelegate.update;
  const originalDel = redis.del;

  let updateData = null;
  let delCalled = false;

  licenseDelegate.update = async ({ data }) => {
    updateData = data;
    return {
      id: "lic_123",
      tenantId: "tenant_abc",
      ...data,
      usage: null,
    };
  };
  redis.del = async () => {
    delCalled = true;
    return 1;
  };

  t.after(() => {
    licenseDelegate.update = originalUpdate;
    redis.del = originalDel;
  });

  const result = await service.upgradePlan("tenant_abc", "ENTERPRISE");

  assert.equal(updateData.plan, "ENTERPRISE");
  assert.equal(updateData.maxUsers, -1); // Unlimited
  assert.ok(delCalled, "Cache should have been invalidated");
});
