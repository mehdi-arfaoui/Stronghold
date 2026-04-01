import crypto from 'node:crypto';

import type { EncryptedPayload } from '../types/encryption.js';

const ENCRYPTION_VERSION = 1;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_DERIVATION_ALGORITHM = 'sha256';
const KEY_DERIVATION_ITERATIONS = 100_000;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;

export class EncryptionError extends Error {
  public constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'EncryptionError';
  }
}

/**
 * Encrypts a UTF-8 string with a passphrase-derived key.
 */
export function encrypt(data: string, passphrase: string): EncryptedPayload {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: ENCRYPTION_VERSION,
    algorithm: ENCRYPTION_ALGORITHM,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('base64'),
  };
}

/**
 * Decrypts an encrypted payload produced by {@link encrypt}.
 */
export function decrypt(payload: EncryptedPayload, passphrase: string): string {
  validatePayload(payload);

  const salt = Buffer.from(payload.salt, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const key = deriveKey(passphrase, salt);

  try {
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(payload.data, 'base64'),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (cause) {
    throw new EncryptionError('Invalid passphrase or corrupted encrypted payload.', {
      cause,
    });
  }
}

/**
 * Checks whether a value matches the encrypted payload format.
 */
export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === ENCRYPTION_VERSION &&
    value.algorithm === ENCRYPTION_ALGORITHM &&
    isNonEmptyString(value.salt) &&
    isNonEmptyString(value.iv) &&
    isNonEmptyString(value.tag) &&
    isNonEmptyString(value.data)
  );
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length === 0) {
    throw new EncryptionError('Passphrase is required for encryption.');
  }

  return crypto.pbkdf2Sync(
    passphrase,
    salt,
    KEY_DERIVATION_ITERATIONS,
    KEY_BYTES,
    KEY_DERIVATION_ALGORITHM,
  );
}

function validatePayload(payload: EncryptedPayload): void {
  if (!isEncryptedPayload(payload)) {
    throw new EncryptionError('Unsupported encrypted payload format.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
