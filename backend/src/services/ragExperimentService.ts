import crypto from "node:crypto";
import prisma from "../prismaClient.js";
import type { RagRuntimeConfig } from "../ai/ragRuntime.js";

export type RagExperimentVariant = {
  key: string;
  label: string;
  runtimeConfig: RagRuntimeConfig;
};

const DEFAULT_EXPERIMENT_KEY = "rag-retrieval-v1";
const DEFAULT_SUBJECT_ID = "tenant";
const VARIANTS: RagExperimentVariant[] = [
  {
    key: "bm25-only",
    label: "BM25 uniquement",
    runtimeConfig: {
      mode: "lexical",
      rerankStrategy: "none",
    },
  },
  {
    key: "bm25-embeddings",
    label: "BM25 + embeddings",
    runtimeConfig: {
      mode: "hybrid",
      rerankStrategy: "none",
    },
  },
  {
    key: "rerank-rrf",
    label: "Reranking RRF",
    runtimeConfig: {
      mode: "hybrid",
      rerankStrategy: "rrf",
    },
  },
];

function pickVariant(seed: string): RagExperimentVariant {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  const bucket = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
  const segment = 1 / VARIANTS.length;
  const index = bucket < segment ? 0 : bucket < segment * 2 ? 1 : 2;
  return VARIANTS[index] ?? VARIANTS[0];
}

export async function getOrCreateRagExperimentAssignment(params: {
  tenantId: string;
  subjectId?: string | null;
  experimentKey?: string;
}) {
  const experimentKey = params.experimentKey ?? DEFAULT_EXPERIMENT_KEY;
  const subjectId = params.subjectId?.trim() || DEFAULT_SUBJECT_ID;

  const existing = await prisma.ragExperimentAssignment.findFirst({
    where: { tenantId: params.tenantId, experimentKey, subjectId },
  });

  if (existing) {
    const variant = VARIANTS.find((item) => item.key === existing.variant) ?? VARIANTS[0];
    return { assignment: existing, variant };
  }

  const variant = pickVariant(`${params.tenantId}:${subjectId}:${experimentKey}`);
  const assignment = await prisma.ragExperimentAssignment.create({
    data: {
      tenantId: params.tenantId,
      experimentKey,
      subjectId,
      variant: variant.key,
      context: {
        label: variant.label,
      },
    },
  });

  return { assignment, variant };
}

export async function recordRagExperimentFeedback(params: {
  tenantId: string;
  experimentKey: string;
  subjectId: string;
  variant: string;
  rating?: number | null;
  comment?: string | null;
}) {
  return prisma.ragExperimentFeedback.create({
    data: {
      tenantId: params.tenantId,
      experimentKey: params.experimentKey,
      subjectId: params.subjectId,
      variant: params.variant,
      rating: params.rating ?? null,
      comment: params.comment ?? null,
    },
  });
}

export function buildRuntimeConfigFromVariant(
  variant: RagExperimentVariant,
  experimentKey: string
): RagRuntimeConfig {
  return {
    ...variant.runtimeConfig,
    experimentKey,
    variant: variant.key,
  };
}
