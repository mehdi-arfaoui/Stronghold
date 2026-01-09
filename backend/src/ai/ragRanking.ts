export type RagChunkCandidate = {
  chunkKey: string;
  documentId: string;
  documentName: string;
  documentType?: string | null;
  text: string;
  score: number;
  bm25Score?: number;
  vectorScore?: number;
  fusedScore?: number;
  rrfScore?: number;
};

const DEFAULT_RRF_K = 60;

function normalizeScores(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return values.map((value) => (value > 0 ? 1 : 0));
  }
  return values.map((value) => (value - min) / (max - min));
}

export function fuseChunkScores(candidates: RagChunkCandidate[], alpha: number): RagChunkCandidate[] {
  const vectorScores = candidates.map((c) => c.vectorScore ?? 0);
  const bm25Scores = candidates.map((c) => c.bm25Score ?? 0);
  const normalizedVector = normalizeScores(vectorScores);
  const normalizedBm25 = normalizeScores(bm25Scores);

  return candidates.map((candidate, index) => {
    const fused = alpha * normalizedVector[index] + (1 - alpha) * normalizedBm25[index];
    return {
      ...candidate,
      fusedScore: fused,
      score: Number(fused.toFixed(4)),
    };
  });
}

export function rerankChunksRrf(
  candidates: RagChunkCandidate[],
  rankLists: { vector: string[]; bm25: string[] },
  k: number = DEFAULT_RRF_K
): RagChunkCandidate[] {
  const vectorRanks = new Map(rankLists.vector.map((key, idx) => [key, idx + 1]));
  const bm25Ranks = new Map(rankLists.bm25.map((key, idx) => [key, idx + 1]));

  return candidates.map((candidate) => {
    const vectorRank = vectorRanks.get(candidate.chunkKey);
    const bm25Rank = bm25Ranks.get(candidate.chunkKey);
    const score =
      (vectorRank ? 1 / (k + vectorRank) : 0) + (bm25Rank ? 1 / (k + bm25Rank) : 0);
    return {
      ...candidate,
      rrfScore: score,
      score: Number(score.toFixed(6)),
    };
  });
}
