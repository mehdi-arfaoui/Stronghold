import prisma from "../prismaClient.js";
import { generateApiKey } from "./apiKeyService.js";
import { encryptSecret, isSecretVaultEnabled } from "./secretVaultService.js";

type RotationResult = {
  rotated: number;
  skipped: number;
  reason?: string;
};

function parseDaysEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function resolveRotationWindowDays(): number {
  return parseDaysEnv("API_KEY_ROTATION_DAYS_BEFORE_EXPIRY", 7);
}

function resolveNewKeyTtlDays(): number {
  return parseDaysEnv("API_KEY_ROTATION_NEW_TTL_DAYS", 90);
}

function resolveRotationBatchSize(): number {
  const value = Number(process.env.API_KEY_ROTATION_BATCH_SIZE || 50);
  return Math.max(1, Math.floor(value));
}

export async function rotateExpiringApiKeys(): Promise<RotationResult> {
  if (!isSecretVaultEnabled()) {
    return { rotated: 0, skipped: 0, reason: "secret_vault_disabled" };
  }

  const now = new Date();
  const windowDays = resolveRotationWindowDays();
  const threshold = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const batchSize = resolveRotationBatchSize();

  const candidates = await prisma.apiKey.findMany({
    where: {
      revokedAt: null,
      expiresAt: { not: null, lte: threshold },
      rotatedTo: { none: {} },
    },
    take: batchSize,
    orderBy: { expiresAt: "asc" },
  });

  if (candidates.length === 0) {
    return { rotated: 0, skipped: 0 };
  }

  let rotated = 0;
  let skipped = 0;
  const newKeyTtlDays = resolveNewKeyTtlDays();

  for (const key of candidates) {
    const { raw, hash } = generateApiKey();
    const encrypted = encryptSecret(raw);
    if (!encrypted) {
      skipped += 1;
      continue;
    }

    const expiresAt = new Date(now.getTime() + newKeyTtlDays * 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      await tx.apiKey.create({
        data: {
          tenantId: key.tenantId,
          label: key.label,
          keyHash: hash,
          role: key.role,
          expiresAt,
          rotatedFromId: key.id,
          lastReviewedAt: new Date(),
          keyCiphertext: encrypted.ciphertext,
          keyIv: encrypted.iv,
          keyTag: encrypted.tag,
          keyAlgorithm: encrypted.algorithm,
        },
      });

      await tx.apiKey.updateMany({
        where: { id: key.id, tenantId: key.tenantId },
        data: { revokedAt: new Date() },
      });
    });

    rotated += 1;
  }

  return { rotated, skipped };
}
