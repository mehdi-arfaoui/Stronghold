import crypto from "crypto";

export type ApiKeyPair = {
  raw: string;
  hash: string;
};

export function generateApiKey(): ApiKeyPair {
  const raw = `sk_${crypto.randomBytes(32).toString("hex")}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
