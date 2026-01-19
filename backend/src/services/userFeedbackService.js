import prisma from "../prismaClient.js";

function normalizeType(value) {
  return value.trim().toUpperCase();
}

export async function recordUserFeedback(input, prismaClient = prisma) {
  return prismaClient.userFeedback.create({
    data: {
      tenantId: input.tenantId,
      resourceId: input.resourceId,
      type: normalizeType(input.type),
      rating: input.rating ?? null,
      comment: input.comment ?? null,
      createdAt: input.timestamp ?? undefined,
    },
  });
}

export const __test__ = {
  normalizeType,
};
