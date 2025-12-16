require("ts-node/register");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  DocumentNotFoundError,
  MissingExtractedTextError,
  getOrCreateExtractedFacts,
} = require("../src/services/extractedFactService");

const baseDocument = {
  id: "doc-1",
  tenantId: "tenant-1",
  textContent: "Extrait simulé du document.",
  originalName: "test.txt",
  docType: "ARCHI",
};

function buildPrismaStub(overrides = {}) {
  return {
    document: {
      findFirst: async () => baseDocument,
    },
    extractedFact: {
      findMany: async () => [],
      deleteMany: async () => ({}),
      create: async () => ({}),
    },
    ...overrides,
  };
}

test("returns existing facts when force is false", async () => {
  const existingFact = {
    id: "fact-1",
    tenantId: "tenant-1",
    documentId: "doc-1",
    type: "PRA_PCA_FACT",
    category: "SERVICE",
    label: "Service criticality",
    data: "{\"name\":\"ERP\"}",
    source: "page 1",
    confidence: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const prismaStub = buildPrismaStub({
    extractedFact: {
      findMany: async () => [existingFact],
    },
  });

  let analyzerCalled = false;
  const result = await getOrCreateExtractedFacts(
    "doc-1",
    "tenant-1",
    false,
    prismaStub,
    async () => {
      analyzerCalled = true;
      return [];
    }
  );

  assert.equal(analyzerCalled, false);
  assert.equal(result.documentId, "doc-1");
  assert.equal(result.facts.length, 1);
  assert.deepEqual(result.facts[0].data, { name: "ERP" });
  assert.equal(result.facts[0].category, "SERVICE");
});

test("throws when document has no extracted text", async () => {
  const prismaStub = buildPrismaStub({
    document: {
      findFirst: async () => ({
        ...baseDocument,
        textContent: null,
      }),
    },
  });

  await assert.rejects(
    () => getOrCreateExtractedFacts("doc-1", "tenant-1", false, prismaStub),
    MissingExtractedTextError
  );
});

test("creates new facts via analyzer", async () => {
  const created = [];
  const prismaStub = buildPrismaStub({
    extractedFact: {
      findMany: async () => [],
      deleteMany: async () => ({}),
      create: async ({ data }) => {
        const record = {
          id: `fact-${created.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        created.push(record);
        return record;
      },
    },
  });

  const analyzerStub = async () => [
    {
      type: "PRA_PCA_FACT",
      category: "RISK",
      label: "Risque inondation",
      data: { location: "Datacenter", mitigation: "Plan PRA annuel" },
      source: "section 2",
      confidence: 0.9,
    },
  ];

  const result = await getOrCreateExtractedFacts(
    "doc-1",
    "tenant-1",
    true,
    prismaStub,
    analyzerStub
  );

  assert.equal(created.length, 1);
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].label, "Risque inondation");
  assert.equal(result.facts[0].category, "RISK");
  assert.equal(result.facts[0].confidence, 0.9);
  assert.deepEqual(result.facts[0].data, {
    location: "Datacenter",
    mitigation: "Plan PRA annuel",
  });
});

test("throws when document not found", async () => {
  const prismaStub = buildPrismaStub({
    document: {
      findFirst: async () => null,
    },
  });

  await assert.rejects(
    () => getOrCreateExtractedFacts("missing", "tenant-1", false, prismaStub),
    DocumentNotFoundError
  );
});
