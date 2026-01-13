import prisma from "../prismaClient.js";

export type EntityFeedbackInput = {
  tenantId: string;
  entityType: string;
  entityId?: string | null;
  documentId?: string | null;
  action: string;
  originalValue?: unknown;
  correctedValue?: unknown;
  notes?: string | null;
  context?: Record<string, unknown> | null;
};

export type RecommendationFeedbackInput = {
  tenantId: string;
  recommendationType: string;
  recommendationId?: string | null;
  rating: "like" | "dislike";
  score?: number | null;
  comment?: string | null;
  context?: Record<string, unknown> | null;
};

function normalizeLabel(value: string): string {
  return value.trim().toUpperCase();
}

export async function recordEntityFeedback(input: EntityFeedbackInput) {
  return prisma.entityFeedback.create({
    data: {
      tenantId: input.tenantId,
      entityType: normalizeLabel(input.entityType),
      entityId: input.entityId ?? null,
      documentId: input.documentId ?? null,
      action: normalizeLabel(input.action),
      originalValue: input.originalValue ?? null,
      correctedValue: input.correctedValue ?? null,
      notes: input.notes ?? null,
      context: input.context ?? null,
    },
  });
}

export async function recordRecommendationFeedback(input: RecommendationFeedbackInput) {
  return prisma.recommendationFeedback.create({
    data: {
      tenantId: input.tenantId,
      recommendationType: normalizeLabel(input.recommendationType),
      recommendationId: input.recommendationId ?? null,
      rating: input.rating,
      score: input.score ?? null,
      comment: input.comment ?? null,
      context: input.context ?? null,
    },
  });
}
