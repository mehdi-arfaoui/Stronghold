import { isEncryptedCredential } from "./credential-encryption.js";

const SENSITIVE_KEY_PATTERN = /(secret|password|private[_-]?key|token|credential|access[_-]?key|client[_-]?secret|kubeconfig)/i;

export function maskCredential(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function maskCredentialField(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "********";
  if (isEncryptedCredential(value)) return "********";
  if (SENSITIVE_KEY_PATTERN.test(key)) return "********";
  return maskCredential(value);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function sanitizeCredentialRecord(
  input: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    sanitized[key] = maskCredentialField(key, value);
  }
  return sanitized;
}

export function sanitizeSensitiveObject(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (isEncryptedCredential(value)) return "********";
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSensitiveObject(entry));
  }
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        sanitized[key] = maskCredentialField(key, nested);
      } else {
        sanitized[key] = sanitizeSensitiveObject(nested);
      }
    }
    return sanitized;
  }
  return String(value);
}
