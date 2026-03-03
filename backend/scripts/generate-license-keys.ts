import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const backendRoot = path.resolve(path.dirname(currentFilePath), '..');
const privateKeyPath = path.join(backendRoot, 'license-private.pem');
const publicKeyPath = path.join(backendRoot, 'license-public.pem');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

fs.writeFileSync(
  privateKeyPath,
  privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }),
  'utf-8',
);

fs.writeFileSync(
  publicKeyPath,
  publicKey.export({
    type: 'spki',
    format: 'pem',
  }),
  'utf-8',
);

console.warn('Warning: license-private.pem must never be committed or copied into Docker images.');
console.log(`Private key written to ${privateKeyPath}`);
console.log(`Public key written to ${publicKeyPath}`);
