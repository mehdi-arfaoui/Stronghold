import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SignJWT, importPKCS8 } from 'jose';
import { test } from 'node:test';
import { LicenseService } from '../src/services/licenseService.ts';

type BindingRecord = {
  id: string;
  licenseId: string;
  fingerprint: string;
  boundAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function generateKeys() {
  return crypto.generateKeyPairSync('ed25519');
}

function writePublicKey(tempDir: string, publicKey: crypto.KeyObject): string {
  const publicKeyPath = path.join(tempDir, 'license-public.pem');
  fs.writeFileSync(
    publicKeyPath,
    publicKey.export({ type: 'spki', format: 'pem' }),
    'utf-8',
  );
  return publicKeyPath;
}

function createPrismaMock(initialBindings: BindingRecord[] = []) {
  const bindings = new Map(initialBindings.map((entry) => [entry.licenseId, entry]));

  return {
    bindings,
    prisma: {
      licenseBinding: {
        findUnique: async ({ where }: { where: { licenseId: string } }) =>
          bindings.get(where.licenseId) ?? null,
        create: async ({ data }: { data: { licenseId: string; fingerprint: string } }) => {
          const record: BindingRecord = {
            id: `binding-${bindings.size + 1}`,
            licenseId: data.licenseId,
            fingerprint: data.fingerprint,
            boundAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          bindings.set(data.licenseId, record);
          return record;
        },
      },
    },
  };
}

function configureEnv(t: Parameters<typeof test>[1], licensePath: string, publicKeyPath: string) {
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
}

async function signLicense(
  privateKey: crypto.KeyObject,
  overrides: Partial<{
    lid: string;
    company: string;
    plan: 'starter' | 'pro' | 'enterprise';
    maxNodes: number;
    maxUsers: number;
    maxCloudEnvs: number;
    features: string[];
    iat: number;
    exp: number;
  }> = {},
) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    lid: overrides.lid ?? 'lic_test',
    company: overrides.company ?? 'Acme',
    plan: overrides.plan ?? 'pro',
    maxNodes: overrides.maxNodes ?? 200,
    maxUsers: overrides.maxUsers ?? 20,
    maxCloudEnvs: overrides.maxCloudEnvs ?? 3,
    features: overrides.features ?? ['discovery', 'report-docx', 'api-export'],
    iat: overrides.iat ?? nowSeconds,
    exp: overrides.exp ?? nowSeconds + 30 * 24 * 60 * 60,
  };

  const signingKey = await importPKCS8(
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    'EdDSA',
  );

  return new SignJWT({
    lid: payload.lid,
    company: payload.company,
    plan: payload.plan,
    maxNodes: payload.maxNodes,
    maxUsers: payload.maxUsers,
    maxCloudEnvs: payload.maxCloudEnvs,
    features: payload.features,
  })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt(payload.iat)
    .setExpirationTime(payload.exp)
    .sign(signingKey);
}

function createServiceContext(t: Parameters<typeof test>[1], options?: { bindings?: BindingRecord[] }) {
  const tempDir = makeTempDir('stronghold-license-');
  const keys = generateKeys();
  const publicKeyPath = writePublicKey(tempDir, keys.publicKey);
  const licensePath = path.join(tempDir, 'stronghold.lic');
  const prismaMock = createPrismaMock(options?.bindings ?? []);
  configureEnv(t, licensePath, publicKeyPath);
  const service = new LicenseService(prismaMock.prisma as never);
  return {
    tempDir,
    licensePath,
    privateKey: keys.privateKey,
    service,
    bindings: prismaMock.bindings,
  };
}

test('LicenseService validates a valid license and is operational', async (t) => {
  const { service, licensePath, privateKey } = createServiceContext(t);
  fs.writeFileSync(licensePath, await signLicense(privateKey), 'utf-8');
  (service as any).generateFingerprint = async () => 'fp-valid';

  const status = await service.validate();

  assert.equal(status, 'valid');
  assert.equal(service.isOperational(), true);
});

test('LicenseService enters grace period when the license expired less than 15 days ago', async (t) => {
  const { service, licensePath, privateKey } = createServiceContext(t);
  const exp = Math.floor(Date.now() / 1000) - 5 * 24 * 60 * 60;
  fs.writeFileSync(licensePath, await signLicense(privateKey, { exp }), 'utf-8');
  (service as any).generateFingerprint = async () => 'fp-grace';

  const status = await service.validate();

  assert.equal(status, 'grace_period');
  assert.equal(service.isOperational(), true);
});

test('LicenseService expires a license beyond the grace period', async (t) => {
  const { service, licensePath, privateKey } = createServiceContext(t);
  const exp = Math.floor(Date.now() / 1000) - 20 * 24 * 60 * 60;
  fs.writeFileSync(licensePath, await signLicense(privateKey, { exp }), 'utf-8');
  (service as any).generateFingerprint = async () => 'fp-expired';

  const status = await service.validate();

  assert.equal(status, 'expired');
  assert.equal(service.isOperational(), false);
});

test('LicenseService rejects invalid signatures', async (t) => {
  const { service, licensePath } = createServiceContext(t);
  const wrongKeys = generateKeys();
  fs.writeFileSync(licensePath, await signLicense(wrongKeys.privateKey), 'utf-8');

  const status = await service.validate();

  assert.equal(status, 'invalid_signature');
});

test('LicenseService reports not_found when the license file does not exist', async (t) => {
  const { service } = createServiceContext(t);

  const status = await service.validate();

  assert.equal(status, 'not_found');
});

test('LicenseService detects a fingerprint mismatch', async (t) => {
  const { service, licensePath, privateKey } = createServiceContext(t, {
    bindings: [
      {
        id: 'binding-1',
        licenseId: 'lic_test',
        fingerprint: 'fp-other-server',
        boundAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  });
  fs.writeFileSync(licensePath, await signLicense(privateKey), 'utf-8');
  (service as any).generateFingerprint = async () => 'fp-current-server';

  const status = await service.validate();

  assert.equal(status, 'fingerprint_mismatch');
});

test('LicenseService binds the first machine fingerprint on first launch', async (t) => {
  const { service, licensePath, privateKey, bindings } = createServiceContext(t);
  fs.writeFileSync(licensePath, await signLicense(privateKey), 'utf-8');
  (service as any).generateFingerprint = async () => 'fp-first-launch';

  const status = await service.validate();

  assert.equal(status, 'valid');
  assert.equal(bindings.get('lic_test')?.fingerprint, 'fp-first-launch');
});

test('LicenseService.hasFeature reflects the signed plan features', async (t) => {
  const { service, licensePath, privateKey } = createServiceContext(t);
  fs.writeFileSync(
    licensePath,
    await signLicense(privateKey, {
      features: ['discovery', 'report-docx', 'api-export'],
    }),
    'utf-8',
  );
  (service as any).generateFingerprint = async () => 'fp-features';

  await service.validate();

  assert.equal(service.hasFeature('report-docx'), true);
  assert.equal(service.hasFeature('sso'), false);
});

test('LicenseService.getMaxNodes reflects the signed plan limits', async (t) => {
  const { service, licensePath, privateKey } = createServiceContext(t);
  fs.writeFileSync(
    licensePath,
    await signLicense(privateKey, {
      plan: 'enterprise',
      maxNodes: -1,
      maxUsers: -1,
      maxCloudEnvs: -1,
      features: ['discovery', 'sso'],
    }),
    'utf-8',
  );
  (service as any).generateFingerprint = async () => 'fp-limits';

  await service.validate();

  assert.equal(service.getMaxNodes(), -1);
  assert.equal(service.getMaxUsers(), -1);
  assert.equal(service.getMaxCloudEnvs(), -1);
});
