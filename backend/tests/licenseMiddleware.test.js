require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { test, mock } = require("node:test");

const {
  requireValidLicense,
  requireFeature,
  requireQuota,
  incrementQuotaOnSuccess,
} = require("../src/middleware/licenseMiddleware");

const licenseServiceModule = require("../src/services/licenseService");
const { licenseService } = licenseServiceModule;

// Helper to create mock request/response
function createMockReqRes(overrides = {}) {
  const req = {
    tenantId: "tenant_123",
    ...overrides,
  };
  const res = {
    statusCode: 200,
    _status: null,
    _json: null,
    status(code) {
      this._status = code;
      this.statusCode = code;
      return this;
    },
    json(body) {
      this._json = body;
      return this;
    },
  };
  return { req, res };
}

test("requireValidLicense calls next() if license is valid", async (t) => {
  const { req, res } = createMockReqRes();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  const originalIsValid = licenseService.isValid;
  licenseService.isValid = async () => ({ valid: true });

  t.after(() => {
    licenseService.isValid = originalIsValid;
  });

  await requireValidLicense()(req, res, next);

  assert.ok(nextCalled, "next() should have been called");
  assert.equal(res._status, null, "status should not have been set");
});

test("requireValidLicense returns 403 if license is invalid", async (t) => {
  const { req, res } = createMockReqRes();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  const originalIsValid = licenseService.isValid;
  licenseService.isValid = async () => ({ valid: false, reason: "License suspended" });

  t.after(() => {
    licenseService.isValid = originalIsValid;
  });

  await requireValidLicense()(req, res, next);

  assert.ok(!nextCalled, "next() should not have been called");
  assert.equal(res._status, 403);
  assert.equal(res._json.error, "LICENSE_INVALID");
});

test("requireValidLicense returns 401 if no tenantId", async (t) => {
  const { req, res } = createMockReqRes({ tenantId: undefined });
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  await requireValidLicense()(req, res, next);

  assert.ok(!nextCalled, "next() should not have been called");
  assert.equal(res._status, 401);
  assert.equal(res._json.error, "TENANT_NOT_IDENTIFIED");
});

test("requireFeature calls next() if feature is available", async (t) => {
  const { req, res } = createMockReqRes();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  const originalHasFeature = licenseService.hasFeature;
  licenseService.hasFeature = async () => true;

  t.after(() => {
    licenseService.hasFeature = originalHasFeature;
  });

  await requireFeature("discovery")(req, res, next);

  assert.ok(nextCalled, "next() should have been called");
});

test("requireFeature returns 403 if feature not available", async (t) => {
  const { req, res } = createMockReqRes();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  const originalHasFeature = licenseService.hasFeature;
  licenseService.hasFeature = async () => false;

  t.after(() => {
    licenseService.hasFeature = originalHasFeature;
  });

  await requireFeature("pra")(req, res, next);

  assert.ok(!nextCalled, "next() should not have been called");
  assert.equal(res._status, 403);
  assert.equal(res._json.error, "FEATURE_NOT_AVAILABLE");
  assert.equal(res._json.feature, "pra");
});

test("requireQuota calls next() if quota allows", async (t) => {
  const { req, res } = createMockReqRes();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  const originalCheckQuota = licenseService.checkQuota;
  licenseService.checkQuota = async () => ({
    allowed: true,
    current: 5,
    max: 10,
    remaining: 5,
  });

  t.after(() => {
    licenseService.checkQuota = originalCheckQuota;
  });

  await requireQuota("scans", 1)(req, res, next);

  assert.ok(nextCalled, "next() should have been called");
  assert.deepEqual(req.quotaToIncrement, { type: "scans", amount: 1 });
});

test("requireQuota returns 429 if quota exceeded", async (t) => {
  const { req, res } = createMockReqRes();
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  const originalCheckQuota = licenseService.checkQuota;
  licenseService.checkQuota = async () => ({
    allowed: false,
    current: 10,
    max: 10,
    remaining: 0,
  });

  t.after(() => {
    licenseService.checkQuota = originalCheckQuota;
  });

  await requireQuota("scans", 1)(req, res, next);

  assert.ok(!nextCalled, "next() should not have been called");
  assert.equal(res._status, 429);
  assert.equal(res._json.error, "QUOTA_EXCEEDED");
});

test("incrementQuotaOnSuccess increments quota on 2xx response", async (t) => {
  const { req, res } = createMockReqRes();
  req.quotaToIncrement = { type: "scans", amount: 1 };
  res.statusCode = 201;

  let incrementCalled = false;
  let incrementArgs = null;

  const originalIncrementUsage = licenseService.incrementUsage;
  licenseService.incrementUsage = async (tenantId, type, amount) => {
    incrementCalled = true;
    incrementArgs = { tenantId, type, amount };
  };

  t.after(() => {
    licenseService.incrementUsage = originalIncrementUsage;
  });

  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  incrementQuotaOnSuccess()(req, res, next);

  assert.ok(nextCalled, "next() should have been called");

  // Trigger the json method to fire the increment
  res.json({ success: true });

  // Wait for async increment
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(incrementCalled, "incrementUsage should have been called");
  assert.equal(incrementArgs.tenantId, "tenant_123");
  assert.equal(incrementArgs.type, "scans");
  assert.equal(incrementArgs.amount, 1);
});

test("incrementQuotaOnSuccess does not increment on error response", async (t) => {
  const { req, res } = createMockReqRes();
  req.quotaToIncrement = { type: "scans", amount: 1 };
  res.statusCode = 400;

  let incrementCalled = false;

  const originalIncrementUsage = licenseService.incrementUsage;
  licenseService.incrementUsage = async () => {
    incrementCalled = true;
  };

  t.after(() => {
    licenseService.incrementUsage = originalIncrementUsage;
  });

  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  incrementQuotaOnSuccess()(req, res, next);
  res.json({ error: "Bad request" });

  // Wait for potential async increment
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(!incrementCalled, "incrementUsage should not have been called for error response");
});
