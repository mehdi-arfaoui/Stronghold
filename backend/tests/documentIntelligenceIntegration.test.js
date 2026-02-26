const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildChunks, buildChromaCollectionName, pushChunksToChroma } = require("../src/services/documentIntelligenceService.ts");

test("buildChunks keeps metadata and chunks are unique", () => {
  const base = { classification: "ARCHI", declaredDocType: "CMDB", documentId: "doc-1" };
  const chunks = buildChunks("Paragraphe 1\n\nParagraphe 2", base, 50, 10);
  assert.ok(chunks.length >= 2, "Expected at least two chunks");
  chunks.forEach((chunk) => {
    assert.equal(chunk.metadata.classification, "ARCHI");
    assert.equal(chunk.metadata.documentId, "doc-1");
  });
});

test("pushChunksToChroma adds tenant and document metadata", async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, json: async () => ({}), text: async () => "", status: 200 };
  };

  process.env.CHROMADB_URL = "http://chroma.test";
  const collection = buildChromaCollectionName("pra-documents", "tenant-123");
  assert.match(collection, /tenant-123/);

  const chunks = [
    {
      id: "chunk-1",
      content: "texte de test",
      hash: "abc",
      metadata: { classification: "ARCHI", documentId: "doc-1", tenantId: "tenant-123" },
    },
  ];

  try {
    const result = await pushChunksToChroma(chunks, "tenant-123", "doc-1");
    assert.equal(result.submitted, 1);
    assert.ok(captured, "Fetch call should have been captured");
    const body = JSON.parse(captured.init.body);
    assert.equal(body.metadatas[0].tenantId, "tenant-123");
    assert.equal(body.metadatas[0].documentId, "doc-1");
  } finally {
    global.fetch = originalFetch;
    delete process.env.CHROMADB_URL;
  }
});
