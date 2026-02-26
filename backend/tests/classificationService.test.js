const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildClassificationCacheKey,
  classifyDocumentFacts,
  computeDocumentHash,
} = require("../src/services/classificationService.ts");

test("classifyDocumentFacts returns cached facts when available", async () => {
  const cacheStore = new Map();
  const cacheClient = {
    get: async (key) => cacheStore.get(key) ?? null,
    set: async (key, value) => {
      cacheStore.set(key, value);
      return "OK";
    },
  };

  const text = "Service ERP critique";
  const docHash = computeDocumentHash(text);
  const cacheKey = buildClassificationCacheKey("tenant-1", docHash);
  cacheStore.set(
    cacheKey,
    JSON.stringify({
      schemaVersion: 1,
      facts: [
        {
          type: "PRA_PCA_FACT",
          category: "SERVICE",
          label: "ERP",
          data: { service: "ERP" },
        },
      ],
    })
  );

  let analyzerCalled = false;
  const result = await classifyDocumentFacts({
    text,
    tenantId: "tenant-1",
    correlationId: "corr-1",
    cacheClient,
    factAnalyzer: async () => {
      analyzerCalled = true;
      return [];
    },
  });

  assert.equal(analyzerCalled, false);
  assert.equal(result.cached, true);
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].label, "ERP");
});

test("classifyDocumentFacts writes to cache after analysis", async () => {
  const cacheStore = new Map();
  const cacheClient = {
    get: async (key) => cacheStore.get(key) ?? null,
    set: async (key, value) => {
      cacheStore.set(key, value);
      return "OK";
    },
  };

  const analyzerFacts = [
    {
      type: "PRA_PCA_FACT",
      category: "INFRA",
      label: "Datacenter",
      data: { infra: "DC1" },
    },
  ];

  const result = await classifyDocumentFacts({
    text: "Datacenter DC1",
    tenantId: "tenant-2",
    correlationId: "corr-2",
    cacheClient,
    factAnalyzer: async () => analyzerFacts,
  });

  const docHash = computeDocumentHash("Datacenter DC1");
  const cacheKey = buildClassificationCacheKey("tenant-2", docHash);

  assert.equal(result.cached, false);
  assert.ok(cacheStore.has(cacheKey));
  const cachedPayload = JSON.parse(cacheStore.get(cacheKey));
  assert.equal(cachedPayload.facts[0].label, "Datacenter");
});

test("updateCachedClassification met à jour une entrée en cache", async () => {
  const cacheStore = new Map();
  const cacheClient = {
    get: async (key) => cacheStore.get(key) ?? null,
    set: async (key, value) => {
      cacheStore.set(key, value);
      return "OK";
    },
  };

  const tenantId = "tenant-3";
  const text = "Service CRM";
  const docHash = computeDocumentHash(text);
  const cacheKey = buildClassificationCacheKey(tenantId, docHash);

  cacheStore.set(
    cacheKey,
    JSON.stringify({
      schemaVersion: 1,
      facts: [
        {
          type: "PRA_PCA_FACT",
          category: "SERVICE",
          label: "CRM",
          data: { service: "CRM" },
          source: "doc",
          confidence: 0.4,
        },
      ],
    })
  );

  const { updateCachedClassification } = require("../src/services/classificationService.ts");

  const updated = await updateCachedClassification({
    tenantId,
    docHash,
    originalFact: { type: "PRA_PCA_FACT", category: "SERVICE", label: "CRM" },
    updatedFact: {
      type: "PRA_PCA_FACT",
      category: "SERVICE",
      label: "CRM Core",
      data: { service: "CRM" },
      source: "review",
      confidence: 0.9,
    },
    cacheClient,
  });

  assert.equal(updated, true);
  const cachedPayload = JSON.parse(cacheStore.get(cacheKey));
  assert.equal(cachedPayload.facts[0].label, "CRM Core");
  assert.equal(cachedPayload.facts[0].confidence, 0.9);
});
