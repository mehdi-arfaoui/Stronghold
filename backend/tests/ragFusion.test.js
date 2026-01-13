require("ts-node/register");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { fuseChunkScores, rerankChunksCrossEncoder, rerankChunksRrf } = require("../src/ai/ragRanking");

test("fuseChunkScores blends BM25 and vector scores via alpha", () => {
  const candidates = [
    {
      chunkKey: "chunk-a",
      documentId: "doc-a",
      documentName: "Doc A",
      text: "alpha text",
      score: 0,
      vectorScore: 0.9,
      bm25Score: 0.2,
    },
    {
      chunkKey: "chunk-b",
      documentId: "doc-b",
      documentName: "Doc B",
      text: "beta text",
      score: 0,
      vectorScore: 0.2,
      bm25Score: 0.8,
    },
  ];

  const vectorWeighted = fuseChunkScores(candidates, 0.8).sort((a, b) => b.score - a.score);
  assert.equal(vectorWeighted[0].chunkKey, "chunk-a");

  const bm25Weighted = fuseChunkScores(candidates, 0.2).sort((a, b) => b.score - a.score);
  assert.equal(bm25Weighted[0].chunkKey, "chunk-b");
});

test("rerankChunksRrf promotes items with strong ranks across lists", () => {
  const candidates = [
    { chunkKey: "chunk-a", documentId: "doc-a", documentName: "Doc A", text: "a", score: 0 },
    { chunkKey: "chunk-b", documentId: "doc-b", documentName: "Doc B", text: "b", score: 0 },
    { chunkKey: "chunk-c", documentId: "doc-c", documentName: "Doc C", text: "c", score: 0 },
  ];

  const reranked = rerankChunksRrf(
    candidates,
    { vector: ["chunk-a", "chunk-b", "chunk-c"], bm25: ["chunk-b", "chunk-c", "chunk-a"] },
    60
  ).sort((a, b) => b.score - a.score);

  assert.equal(reranked[0].chunkKey, "chunk-b");
});

test("rerankChunksCrossEncoder promotes lexical overlap with the query", () => {
  const candidates = [
    {
      chunkKey: "chunk-a",
      documentId: "doc-a",
      documentName: "Doc A",
      text: "plan de reprise après une panne électrique majeure",
      score: 0,
      bm25Score: 0.1,
      vectorScore: 0.2,
    },
    {
      chunkKey: "chunk-b",
      documentId: "doc-b",
      documentName: "Doc B",
      text: "sauvegardes quotidiennes et politique de rétention",
      score: 0,
      bm25Score: 0.3,
      vectorScore: 0.4,
    },
  ];

  const reranked = rerankChunksCrossEncoder(candidates, "panne électrique et reprise")
    .sort((a, b) => b.score - a.score);

  assert.equal(reranked[0].chunkKey, "chunk-a");
});
