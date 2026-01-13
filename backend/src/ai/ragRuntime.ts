export type RagRuntimeConfig = {
  mode?: "lexical" | "hybrid";
  chunkingStrategy?: "adaptive" | "fixed";
  chunkSize?: number | null;
  lexicalChunksPerDoc?: number;
  fusionAlpha?: number | null;
  rerankStrategy?: "none" | "rrf" | "cross";
  crossWeights?: { lexical: number; vector: number; bm25: number } | null;
  experimentKey?: string | null;
  variant?: string | null;
};

export const DEFAULT_RAG_RUNTIME_CONFIG: Required<
  Pick<RagRuntimeConfig, "mode" | "chunkingStrategy" | "lexicalChunksPerDoc">
> = {
  mode: "hybrid",
  chunkingStrategy: "adaptive",
  lexicalChunksPerDoc: 12,
};

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
