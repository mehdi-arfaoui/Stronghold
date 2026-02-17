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
