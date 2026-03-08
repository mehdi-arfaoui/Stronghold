import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  requireFeature,
  requireLicense,
  requirePlan,
} from '../src/middleware/licenseMiddleware.ts';

function createMockLicenseService(overrides: Partial<{
  isOperational: () => boolean;
  getStatus: () => string;
  hasFeature: (feature: string) => boolean;
  getPlan: () => 'starter' | 'pro' | 'enterprise' | null;
}> = {}) {
  return {
    isOperational: () => true,
    getStatus: () => 'valid',
    hasFeature: () => true,
    getPlan: () => 'pro',
    ...overrides,
  };
}

function createReqRes(licenseService: ReturnType<typeof createMockLicenseService>) {
  const req = {
    app: {
      locals: {
        licenseService,
      },
    },
  } as any;

  const headers = new Map<string, string>();
  const res = {
    statusCode: 200,
    body: null as unknown,
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    getHeader(name: string) {
      return headers.get(name);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  } as any;

  return { req, res };
}

function withEnv(overrides: Record<string, string | undefined>, run: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('requireLicense passes when the license is operational', async () => {
  const { req, res } = createReqRes(createMockLicenseService());
  let nextCalled = false;

  requireLicense(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('requireLicense blocks expired licenses with 403', async () => {
  const { req, res } = createReqRes(
    createMockLicenseService({
      isOperational: () => false,
      getStatus: () => 'expired',
    }),
  );

  requireLicense(req, res, () => {});

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    error: 'LICENSE_INVALID',
    licenseStatus: 'expired',
    message: 'Votre licence Stronghold a expire. Contactez support@stronghold.io pour renouveler.',
  });
});

test('requireLicense bypasses checks in internal demo context', async () => {
  const { req, res } = createReqRes(
    createMockLicenseService({
      isOperational: () => false,
      getStatus: () => 'not_found',
    }),
  );
  let nextCalled = false;

  withEnv(
    {
      BUILD_TARGET: 'internal',
      NODE_ENV: 'development',
      APP_ENV: 'demo',
      ALLOW_DEMO_SEED: 'true',
    },
    () => {
      requireLicense(req, res, () => {
        nextCalled = true;
      });
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('requireLicense still blocks when build target is client', async () => {
  const { req, res } = createReqRes(
    createMockLicenseService({
      isOperational: () => false,
      getStatus: () => 'not_found',
    }),
  );

  withEnv(
    {
      BUILD_TARGET: 'client',
      NODE_ENV: 'development',
      APP_ENV: 'demo',
      ALLOW_DEMO_SEED: 'true',
    },
    () => {
      requireLicense(req, res, () => {});
    },
  );

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    error: 'LICENSE_INVALID',
    licenseStatus: 'not_found',
    message: 'Aucune licence trouvee. Veuillez activer Stronghold.',
  });
});

test('requireFeature passes when the feature is present', async () => {
  const { req, res } = createReqRes(createMockLicenseService());
  let nextCalled = false;

  requireFeature('api-export')(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test('requireFeature blocks when the feature is missing', async () => {
  const { req, res } = createReqRes(
    createMockLicenseService({
      hasFeature: () => false,
      getPlan: () => 'starter',
    }),
  );

  requireFeature('report-docx')(req, res, () => {});

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    error: 'FEATURE_NOT_AVAILABLE',
    feature: 'report-docx',
    currentPlan: 'starter',
    message: "Cette fonctionnalite n'est pas disponible avec votre plan actuel.",
  });
});

test("requirePlan('enterprise') blocks a pro license", async () => {
  const { req, res } = createReqRes(
    createMockLicenseService({
      getPlan: () => 'pro',
    }),
  );

  requirePlan('enterprise')(req, res, () => {});

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    error: 'PLAN_INSUFFICIENT',
    requiredPlan: 'enterprise',
    currentPlan: 'pro',
    message: 'Cette fonctionnalite necessite au minimum le plan enterprise.',
  });
});

test("requirePlan('pro') passes for an enterprise license", async () => {
  const { req, res } = createReqRes(
    createMockLicenseService({
      getPlan: () => 'enterprise',
    }),
  );
  let nextCalled = false;

  requirePlan('pro')(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});
