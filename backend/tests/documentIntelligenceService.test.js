require("ts-node/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyDocumentType,
  extractDocumentMetadata,
  buildChunks,
} = require("../src/services/documentIntelligenceService");

test("classifyDocumentType prioritises provided type", () => {
  const result = classifyDocumentType("", "", "RUNBOOK");
  assert.equal(result.type, "RUNBOOK");
  assert.ok(result.confidence > 0.5);
});

test("extractDocumentMetadata detects RTO/RPO and services", () => {
  const text = `Service: Billing API\nRTO: 4h\nRPO: 30`;
  const meta = extractDocumentMetadata(text);
  assert.ok(meta.services.includes("Billing API"));
  assert.equal(meta.rtoHours, 4);
  assert.equal(meta.rpoMinutes, 30);
});

test("buildChunks removes duplicates", () => {
  const chunks = buildChunks("ligne A\n\nligne A\n\nligne B", { tenantId: "t1" }, 20, 5);
  const hashes = new Set(chunks.map((c) => c.hash));
  assert.equal(chunks.length, hashes.size);
});
