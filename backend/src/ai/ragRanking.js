"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rerankChunksCrossEncoder = exports.rerankChunksRrf = exports.fuseChunkScores = void 0;
const DEFAULT_RRF_K = 60;
function normalizeScores(values) {
  if (values.length === 0)
    return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) {
    return values.map((value) => (value > 0 ? 1 : 0));
  }
  return values.map((value) => (value - min) / (max - min));
}
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ\s]/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}
function buildTokenSet(text) {
  return new Set(tokenize(text));
}
function overlapScore(queryTokens, text) {
  if (queryTokens.size === 0)
    return 0;
  const tokens = buildTokenSet(text);
  if (tokens.size === 0)
    return 0;
  let overlap = 0;
  queryTokens.forEach((token) => {
    if (tokens.has(token))
      overlap += 1;
  });
  return overlap / queryTokens.size;
}
function fuseChunkScores(candidates, alpha) {
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
exports.fuseChunkScores = fuseChunkScores;
function rerankChunksRrf(candidates, rankLists, k = DEFAULT_RRF_K) {
  const vectorRanks = new Map(rankLists.vector.map((key, idx) => [key, idx + 1]));
  const bm25Ranks = new Map(rankLists.bm25.map((key, idx) => [key, idx + 1]));
  return candidates.map((candidate) => {
    const vectorRank = vectorRanks.get(candidate.chunkKey);
    const bm25Rank = bm25Ranks.get(candidate.chunkKey);
    const score = (vectorRank ? 1 / (k + vectorRank) : 0) + (bm25Rank ? 1 / (k + bm25Rank) : 0);
    return {
      ...candidate,
      rrfScore: score,
      score: Number(score.toFixed(6)),
    };
  });
}
exports.rerankChunksRrf = rerankChunksRrf;
function rerankChunksCrossEncoder(candidates, question, weights = {
  lexical: 0.5,
  vector: 0.25,
  bm25: 0.25,
}) {
  const queryTokens = buildTokenSet(question);
  const lexicalScores = candidates.map((candidate) => overlapScore(queryTokens, candidate.text));
  const vectorScores = candidates.map((candidate) => candidate.vectorScore ?? 0);
  const bm25Scores = candidates.map((candidate) => candidate.bm25Score ?? 0);
  const normalizedLexical = normalizeScores(lexicalScores);
  const normalizedVector = normalizeScores(vectorScores);
  const normalizedBm25 = normalizeScores(bm25Scores);
  const totalWeight = weights.lexical + weights.vector + weights.bm25 || 1;
  const lexicalWeight = weights.lexical / totalWeight;
  const vectorWeight = weights.vector / totalWeight;
  const bm25Weight = weights.bm25 / totalWeight;
  return candidates.map((candidate, index) => {
    const score = lexicalWeight * normalizedLexical[index] +
      vectorWeight * normalizedVector[index] +
      bm25Weight * normalizedBm25[index];
    return {
      ...candidate,
      crossScore: score,
      score: Number(score.toFixed(6)),
    };
  });
}
exports.rerankChunksCrossEncoder = rerankChunksCrossEncoder;
