import prisma from "../prismaClient.js";
import { toPrismaJson } from "../utils/prismaJson.js";

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
  const data = {
    tenantId: input.tenantId,
    entityType: normalizeLabel(input.entityType),
    entityId: input.entityId ?? null,
    documentId: input.documentId ?? null,
    action: normalizeLabel(input.action),
    notes: input.notes ?? null,
    ...(input.originalValue != null ? { originalValue: toPrismaJson(input.originalValue) } : {}),
    ...(input.correctedValue != null ? { correctedValue: toPrismaJson(input.correctedValue) } : {}),
    ...(input.context != null ? { context: toPrismaJson(input.context) } : {}),
  };
  return prisma.entityFeedback.create({
    data,
  });
}

export async function recordRecommendationFeedback(input: RecommendationFeedbackInput) {
  const data = {
    tenantId: input.tenantId,
    recommendationType: normalizeLabel(input.recommendationType),
    recommendationId: input.recommendationId ?? null,
    rating: input.rating,
    score: input.score ?? null,
    comment: input.comment ?? null,
    ...(input.context != null ? { context: toPrismaJson(input.context) } : {}),
  };
  return prisma.recommendationFeedback.create({
    data,
  });
}
