import crypto from 'node:crypto';

import { isEncryptedPayload, type EncryptedPayload } from '@stronghold-dr/core';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

export interface StoredScanDataFields {
  readonly nodes: unknown;
  readonly edges: unknown;
  readonly analysis: unknown;
  readonly validationReport: unknown;
}

export class ScanDataEncryptionError extends Error {
  public constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'ScanDataEncryptionError';
  }
}

export class ScanDataEncryptionService {
  private readonly key: Buffer;

  public constructor(keyHex: string) {
    this.key = validateKey(keyHex);
  }

  public encryptScanData(data: object): string {
    return this.encryptJsonValue(data);
  }

  public decryptScanData(encrypted: string): object {
    const value = this.decryptJsonValue<unknown>(encrypted);
    if (!isRecord(value)) {
      throw new ScanDataEncryptionError('Encrypted scan data did not decrypt to an object.');
    }
    return value;
  }

  public encryptJsonValue(value: unknown): string {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    const payload: EncryptedPayload = {
      version: ENCRYPTION_VERSION,
      algorithm: ENCRYPTION_ALGORITHM,
      salt: crypto.randomBytes(SALT_BYTES).toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: encrypted.toString('base64'),
    };

    return JSON.stringify(payload);
  }

  public decryptJsonValue<TValue>(encrypted: string): TValue {
    const payload = parseEncryptedPayload(encrypted);
    if (!payload) {
      throw new ScanDataEncryptionError('Encrypted scan data payload is invalid.');
    }

    try {
      const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        this.key,
        Buffer.from(payload.iv, 'hex'),
      );
      decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
      const decrypted = Buffer.concat([
        decipher.update(payload.data, 'base64'),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(decrypted) as TValue;
    } catch (cause) {
      throw new ScanDataEncryptionError('Unable to decrypt scan data with the configured key.', {
        cause,
      });
    }
  }
}

export function createScanDataEncryptionService(
  keyHex?: string,
): ScanDataEncryptionService | null {
  return keyHex ? new ScanDataEncryptionService(keyHex) : null;
}

export function serializeStoredScanData(
  fields: StoredScanDataFields,
  encryptionService: ScanDataEncryptionService | null,
): StoredScanDataFields {
  if (!encryptionService) {
    return fields;
  }

  return {
    nodes: encryptionService.encryptJsonValue(fields.nodes),
    edges: encryptionService.encryptJsonValue(fields.edges),
    analysis: encryptionService.encryptJsonValue(fields.analysis),
    validationReport: encryptionService.encryptJsonValue(fields.validationReport),
  };
}

export function deserializeStoredScanData(
  fields: StoredScanDataFields,
  encryptionService: ScanDataEncryptionService | null,
): StoredScanDataFields {
  return {
    nodes: decodeField(fields.nodes, encryptionService, 'nodes'),
    edges: decodeField(fields.edges, encryptionService, 'edges'),
    analysis: decodeField(fields.analysis, encryptionService, 'analysis'),
    validationReport: decodeField(
      fields.validationReport,
      encryptionService,
      'validationReport',
    ),
  };
}

function decodeField(
  value: unknown,
  encryptionService: ScanDataEncryptionService | null,
  fieldName: keyof StoredScanDataFields,
): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  if (!parseEncryptedPayload(value)) {
    return value;
  }

  if (!encryptionService) {
    throw new ScanDataEncryptionError(
      `Scan data field '${fieldName}' is encrypted but STRONGHOLD_ENCRYPTION_KEY is not configured.`,
    );
  }

  return encryptionService.decryptJsonValue<unknown>(value);
}

function parseEncryptedPayload(value: string): EncryptedPayload | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isEncryptedPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validateKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new ScanDataEncryptionError(
      'STRONGHOLD_ENCRYPTION_KEY must be a 32-byte hex string.',
    );
  }
  return key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
