import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SignJWT, importPKCS8 } from 'jose';
import { test } from 'node:test';
import { createLicenseRoutes } from '../src/routes/licenseRoutes.ts';
import { LicenseService } from '../src/services/licenseService.ts';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-license-routes-'));
}

function createServiceContext(t: Parameters<typeof test>[1]) {
  const tempDir = createTempDir();
  const licensePath = path.join(tempDir, 'stronghold.lic');
  const publicKeyPath = path.join(tempDir, 'license-public.pem');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(
    publicKeyPath,
    publicKey.export({ type: 'spki', format: 'pem' }),
    'utf-8',
  );

  const previousLicensePath = process.env.LICENSE_PATH;
  const previousPublicKeyPath = process.env.LICENSE_PUBLIC_KEY_PATH;
  process.env.LICENSE_PATH = licensePath;
  process.env.LICENSE_PUBLIC_KEY_PATH = publicKeyPath;

  t.after(() => {
    if (previousLicensePath === undefined) {
      delete process.env.LICENSE_PATH;
    } else {
      process.env.LICENSE_PATH = previousLicensePath;
    }
    if (previousPublicKeyPath === undefined) {
      delete process.env.LICENSE_PUBLIC_KEY_PATH;
    } else {
      process.env.LICENSE_PUBLIC_KEY_PATH = previousPublicKeyPath;
    }
  });

  const service = new LicenseService({
    licenseBinding: {
      findUnique: async () => null,
      create: async ({ data }: { data: { licenseId: string; fingerprint: string } }) => ({
        id: 'binding-1',
        licenseId: data.licenseId,
        fingerprint: data.fingerprint,
        boundAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  } as never);
  (service as any).generateFingerprint = async () => 'fp-routes';

  const app = express();
  app.use(express.json());
  app.use('/api/license', createLicenseRoutes(service));

  return { service, app, licensePath, privateKey };
}

async function signLicense(privateKey: crypto.KeyObject, overrides: Partial<{ exp: number }> = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const signingKey = await importPKCS8(
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    'EdDSA',
  );

  return new SignJWT({
    lid: 'lic_routes',
    company: 'Route Test Corp',
    plan: 'pro',
    maxNodes: 200,
    maxUsers: 20,
    maxCloudEnvs: 3,
    features: ['discovery', 'report-docx', 'api-export'],
  })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(overrides.exp ?? nowSeconds + 24 * 60 * 60)
    .sign(signingKey);
}

async function withServer(app: express.Express, handler: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const address = server.address();
  const port = typeof address === 'string' ? 0 : address?.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/license/status returns not_found without a license', async (t) => {
  const { app } = createServiceContext(t);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/license/status`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'not_found');
  });
});

test('POST /api/license/activate accepts a valid token', async (t) => {
  const { app, privateKey } = createServiceContext(t);
  const token = await signLicense(privateKey);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.status, 'valid');
  });
});

test('POST /api/license/activate rejects an invalid token', async (t) => {
  const { app } = createServiceContext(t);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'not-a-jwt' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.success, false);
    assert.equal(payload.status, 'invalid_signature');
  });
});

test('GET /api/license/status returns valid after activation', async (t) => {
  const { app, privateKey } = createServiceContext(t);
  const token = await signLicense(privateKey);

  await withServer(app, async (baseUrl) => {
    await fetch(`${baseUrl}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const response = await fetch(`${baseUrl}/api/license/status`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, 'valid');
    assert.equal(payload.plan, 'pro');
  });
});
