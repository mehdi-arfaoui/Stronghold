import prisma from "../prismaClient.js";
import {
  DEFAULT_RAG_RUNTIME_CONFIG,
  clampNumber,
  type RagRuntimeConfig,
} from "../ai/ragRuntime.js";
import {
  buildRuntimeConfigFromVariant,
  getOrCreateRagExperimentAssignment,
} from "./ragExperimentService.js";
import { ensureMlTrainingIfDue } from "./mlTrainingService.js";

export async function resolveRagRuntimeConfig(params: {
  tenantId: string;
  subjectId?: string | null;
  trigger?: string;
}): Promise<{ runtimeConfig: RagRuntimeConfig; experimentKey: string; variant: string | null }> {
  const trigger = params.trigger ?? "rag-query";
  await ensureMlTrainingIfDue(params.tenantId, trigger);

  const [{ assignment, variant }, tuning] = await Promise.all([
    getOrCreateRagExperimentAssignment({ tenantId: params.tenantId, subjectId: params.subjectId }),
    prisma.ragTuningConfig.findFirst({ where: { tenantId: params.tenantId } }),
  ]);

  const experimentConfig = buildRuntimeConfigFromVariant(variant, assignment.experimentKey);
  const runtimeConfig: RagRuntimeConfig = {
    ...DEFAULT_RAG_RUNTIME_CONFIG,
    ...experimentConfig,
  };

  if (tuning) {
    runtimeConfig.fusionAlpha = clampNumber(tuning.fusionAlpha, 0, 1);
    runtimeConfig.chunkSize = clampNumber(tuning.chunkSize, 480, 1200);
    runtimeConfig.lexicalChunksPerDoc = clampNumber(
      tuning.lexicalChunksPerDoc,
      6,
      20
    );
  }

  return {
    runtimeConfig,
    experimentKey: assignment.experimentKey,
    variant: assignment.variant,
  };
}
