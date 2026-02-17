import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const ENCRYPTED_PAYLOAD_PATTERN = /^[a-f0-9]{32}:[a-f0-9]{32}:[a-f0-9]+$/i;
const CREDENTIAL_ENCRYPTION_KEY_ENV = "CREDENTIAL_ENCRYPTION_KEY";

function parseEncryptionKey(key: string): Buffer {
  const normalized = key.trim();
  if (!/^[a-f0-9]{64}$/i.test(normalized)) {
    throw new Error(`${CREDENTIAL_ENCRYPTION_KEY_ENV} must be a 64-char hex string`);
  }
  const keyBuffer = Buffer.from(normalized, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error(`${CREDENTIAL_ENCRYPTION_KEY_ENV} must decode to 32 bytes`);
  }
  return keyBuffer;
}

export function resolveCredentialEncryptionKey(): string {
  const key = process.env[CREDENTIAL_ENCRYPTION_KEY_ENV];
  if (!key) {
    throw new Error(`${CREDENTIAL_ENCRYPTION_KEY_ENV} is required`);
  }
  parseEncryptionKey(key);
  return key;
}

export function isEncryptedCredential(value: unknown): value is string {
  return typeof value === "string" && ENCRYPTED_PAYLOAD_PATTERN.test(value.trim());
}

export function encryptCredential(plaintext: string, key: string): string {
  const keyBuffer = parseEncryptionKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decryptCredential(ciphertext: string, key: string): string {
  const keyBuffer = parseEncryptionKey(key);
  const [ivHex, tagHex, encrypted] = ciphertext.split(":");
  if (!ivHex || !tagHex || encrypted === undefined) {
    throw new Error("Invalid encrypted credential payload");
  }
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error("Invalid IV or auth tag length");
  }
  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
