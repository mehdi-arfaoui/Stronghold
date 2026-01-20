import prisma from "../prismaClient.js";
import type { Prisma, PrismaClient } from "@prisma/client";

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export type UserFeedbackInput = {
  tenantId: string;
  resourceId: string;
  type: string;
  rating?: number | null;
  comment?: string | null;
  timestamp?: Date | null;
};

function normalizeType(value: string): string {
  return value.trim().toUpperCase();
}

export async function recordUserFeedback(
  input: UserFeedbackInput,
  prismaClient: PrismaClientOrTx = prisma
) {
  return prismaClient.userFeedback.create({
    data: {
      tenantId: input.tenantId,
      resourceId: input.resourceId,
      type: normalizeType(input.type),
      rating: input.rating ?? null,
      comment: input.comment ?? null,
      ...(input.timestamp != null ? { createdAt: input.timestamp } : {}),
    },
  });
}

export const __test__ = {
  normalizeType,
};
