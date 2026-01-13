import crypto from "crypto";

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  tag: string;
};

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function normalizeSecret(secret: string | undefined, envName: string): string {
  if (!secret || secret.trim().length < 16) {
    throw new Error(`${envName} must be set and at least 16 characters long`);
  }
  return secret.trim();
}

export function encryptText(plaintext: string, secret: string): EncryptedPayload {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptText(payload: EncryptedPayload, secret: string): string {
  const key = deriveKey(secret);
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

export function getDocumentEncryptionSecret(): string {
  return normalizeSecret(process.env.DOCUMENT_ENCRYPTION_SECRET, "DOCUMENT_ENCRYPTION_SECRET");
}

export function encryptDocumentText(text: string): EncryptedPayload {
  const secret = getDocumentEncryptionSecret();
  return encryptText(text, secret);
}

export function decryptDocumentText(payload: EncryptedPayload): string {
  const secret = getDocumentEncryptionSecret();
  return decryptText(payload, secret);
}

export type EncryptedDocumentFields = {
  textContent?: string | null;
  textContentCiphertext?: string | null;
  textContentIv?: string | null;
  textContentTag?: string | null;
};

export function resolveEncryptedDocumentText(doc: EncryptedDocumentFields): string | null {
  if (doc.textContent && doc.textContent.trim().length > 0) {
    return doc.textContent;
  }
  if (doc.textContentCiphertext && doc.textContentIv && doc.textContentTag) {
    return decryptDocumentText({
      ciphertext: doc.textContentCiphertext,
      iv: doc.textContentIv,
      tag: doc.textContentTag,
    });
  }
  return null;
}
