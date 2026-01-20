import crypto from "crypto";

export type SecretEnvelope = {
  ciphertext: string;
  iv: string;
  tag: string;
  algorithm: "AES-256-GCM";
};

const MASTER_KEY_ENV = "SECRETS_MASTER_KEY";

function resolveMasterKey(): Buffer | null {
  const raw = process.env[MASTER_KEY_ENV];
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length < 16) {
    throw new Error(`${MASTER_KEY_ENV} must be at least 16 characters long`);
  }
  return crypto.createHash("sha256").update(trimmed).digest();
}

export function isSecretVaultEnabled(): boolean {
  return Boolean(process.env[MASTER_KEY_ENV]);
}

export function encryptSecret(plaintext: string): SecretEnvelope | null {
  const key = resolveMasterKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    algorithm: "AES-256-GCM",
  };
}

export function decryptSecret(payload: SecretEnvelope): string {
  const key = resolveMasterKey();
  if (!key) {
    throw new Error(`${MASTER_KEY_ENV} must be configured to decrypt secrets`);
  }
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function encryptJsonSecret(payload: Record<string, unknown>): SecretEnvelope | null {
  return encryptSecret(JSON.stringify(payload));
}

export function decryptJsonSecret(payload: SecretEnvelope): Record<string, unknown> {
  return JSON.parse(decryptSecret(payload)) as Record<string, unknown>;
}
