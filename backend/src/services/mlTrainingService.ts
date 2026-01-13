import prisma from "../prismaClient.js";
import { clampNumber } from "../ai/ragRuntime.js";

const MAX_SAMPLE_SIZE = 500;
const BASE_FUSION_ALPHA = 0.6;
const BASE_CHUNK_SIZE = 900;
const BASE_LEXICAL_CHUNKS = 12;
const MIN_ALPHA = 0.35;
const MAX_ALPHA = 0.85;
const MIN_CHUNK = 600;
const MAX_CHUNK = 1100;
const MIN_CHUNKS_PER_DOC = 6;
const MAX_CHUNKS_PER_DOC = 16;

function parseTrainingIntervalHours(): number {
  const raw = Number(process.env.ML_TRAINING_INTERVAL_HOURS ?? "24");
  if (!Number.isFinite(raw) || raw <= 0) return 24;
  return raw;
}

function smoothedRatio(positive: number, negative: number, prior = 2): number {
  const total = positive + negative;
  if (total <= 0) return 0.5;
  return (positive + prior) / (total + 2 * prior);
}

function volumeWeight(total: number, target = 20): number {
  if (total <= 0) return 0;
  return clampNumber(total / target, 0, 1);
}

function normalizeCentered(ratio: number): number {
  return clampNumber((ratio - 0.5) * 2, -1, 1);
}

function tallyClassificationAccuracy(records: { predictedType: string | null; correctedType: string }[]) {
  let comparable = 0;
  let correct = 0;
  for (const record of records) {
    if (!record.predictedType) continue;
    comparable += 1;
    if (record.predictedType === record.correctedType) {
      correct += 1;
    }
  }
  return {
    comparable,
    correct,
    accuracy: comparable > 0 ? correct / comparable : null,
  };
}

function isCorrectionAction(action: string) {
  return ["CORRECTED", "UPDATED", "FIXED", "EDITED"].includes(action);
}

export async function ensureMlTrainingIfDue(tenantId: string, trigger: string) {
  if (String(process.env.ML_TRAINING_ENABLED ?? "true").toLowerCase() === "false") {
    return null;
  }
  const intervalHours = parseTrainingIntervalHours();
  const lastRun = await prisma.mlTrainingRun.findFirst({
    where: { tenantId },
    orderBy: { startedAt: "desc" },
  });

  if (lastRun) {
    const elapsedMs = Date.now() - lastRun.startedAt.getTime();
    if (elapsedMs < intervalHours * 60 * 60 * 1000) {
      return null;
    }
  }

  return runMlTrainingForTenant(tenantId, trigger);
}

export async function runMlTrainingForTenant(tenantId: string, trigger: string) {
  const run = await prisma.mlTrainingRun.create({
    data: {
      tenantId,
      status: "RUNNING",
      trigger,
    },
  });

  const [classificationFeedback, recommendationFeedback, entityFeedback] = await Promise.all([
    prisma.documentClassificationFeedback.findMany({
      where: { tenantId },
      select: { predictedType: true, correctedType: true },
      orderBy: { createdAt: "desc" },
      take: MAX_SAMPLE_SIZE,
    }),
    prisma.recommendationFeedback.findMany({
      where: { tenantId },
      select: { rating: true },
      orderBy: { createdAt: "desc" },
      take: MAX_SAMPLE_SIZE,
    }),
    prisma.entityFeedback.findMany({
      where: { tenantId },
      select: { action: true },
      orderBy: { createdAt: "desc" },
      take: MAX_SAMPLE_SIZE,
    }),
  ]);

  const classificationStats = tallyClassificationAccuracy(classificationFeedback);
  const likes = recommendationFeedback.filter((item) => item.rating === "like").length;
  const dislikes = recommendationFeedback.length - likes;
  const likeRatio = smoothedRatio(likes, dislikes);
  const likeSignal = normalizeCentered(likeRatio) * volumeWeight(likes + dislikes);

  const correctionCount = entityFeedback.filter((item) => isCorrectionAction(item.action)).length;
  const correctionRatio =
    entityFeedback.length > 0 ? correctionCount / entityFeedback.length : 0.5;
  const correctionSignal = normalizeCentered(1 - correctionRatio) * volumeWeight(entityFeedback.length);

  const fusionAlpha = clampNumber(
    BASE_FUSION_ALPHA + likeSignal * 0.15,
    MIN_ALPHA,
    MAX_ALPHA
  );
  const chunkSize = Math.round(
    clampNumber(BASE_CHUNK_SIZE + correctionSignal * 140, MIN_CHUNK, MAX_CHUNK)
  );
  const lexicalChunksPerDoc = Math.round(
    clampNumber(BASE_LEXICAL_CHUNKS + likeSignal * 3, MIN_CHUNKS_PER_DOC, MAX_CHUNKS_PER_DOC)
  );

  const ragTuning = await prisma.ragTuningConfig.upsert({
    where: { tenantId },
    update: {
      fusionAlpha,
      chunkSize,
      lexicalChunksPerDoc,
      normalizationStats: {
        likeRatio,
        likeSignal,
        correctionRatio,
        correctionSignal,
        classificationAccuracy: classificationStats.accuracy,
      },
    },
    create: {
      tenantId,
      fusionAlpha,
      chunkSize,
      lexicalChunksPerDoc,
      normalizationStats: {
        likeRatio,
        likeSignal,
        correctionRatio,
        correctionSignal,
        classificationAccuracy: classificationStats.accuracy,
      },
    },
  });

  await prisma.mlTrainingRun.updateMany({
    where: { id: run.id, tenantId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      classificationSampleSize: classificationFeedback.length,
      entitySampleSize: entityFeedback.length,
      recommendationSampleSize: recommendationFeedback.length,
      ragTuningSnapshot: {
        fusionAlpha: ragTuning.fusionAlpha,
        chunkSize: ragTuning.chunkSize,
        lexicalChunksPerDoc: ragTuning.lexicalChunksPerDoc,
      },
      metrics: {
        classification: classificationStats,
        recommendations: { likes, dislikes, likeRatio },
        entityCorrections: { correctionCount, total: entityFeedback.length, correctionRatio },
      },
    },
  });

  return ragTuning;
}
