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
    key: "lexical-fixed",
    label: "Lexical only with fixed chunk size",
    runtimeConfig: {
      mode: "lexical",
      chunkingStrategy: "fixed",
      chunkSize: 720,
      lexicalChunksPerDoc: 8,
    },
  },
  {
    key: "hybrid-adaptive",
    label: "Hybrid retrieval with adaptive chunking",
    runtimeConfig: {
      mode: "hybrid",
      chunkingStrategy: "adaptive",
      lexicalChunksPerDoc: 12,
    },
  },
];

function pickVariant(seed: string): RagExperimentVariant {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  const bucket = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
  const index = bucket < 0.5 ? 0 : 1;
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
