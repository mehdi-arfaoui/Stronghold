require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { analyzeExtractedFacts } = require("../src/ai/extractedFactsAnalyzer");

const originalFetch = global.fetch;
const originalApiKey = process.env.OPENAI_API_KEY;

const buildResponsePayload = (label) => ({
  output: [
    {
      content: [
        {
          json: {
            facts: [
              {
                type: "PRA_PCA_FACT",
                category: "SERVICE",
                label,
                data: { label },
                source: "p1",
                confidence: 0.8,
              },
            ],
          },
        },
      ],
    },
  ],
});

test.after(() => {
  global.fetch = originalFetch;
  process.env.OPENAI_API_KEY = originalApiKey;
});

test("splits long text into multiple AI calls and merges facts with chunkIndex", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const requests = [];

  const responses = [
    buildResponsePayload("fact-1"),
    buildResponsePayload("fact-2"),
    buildResponsePayload("fact-3"),
  ];

  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);

    return {
      ok: true,
      json: async () => responses[requests.length - 1],
    };
  };

  const chunkText = "A".repeat(12_000) + "B".repeat(12_000) + "C".repeat(1_000);
  const facts = await analyzeExtractedFacts({
    text: chunkText,
    documentName: "doc.txt",
    docType: "ARCHI",
  });

  assert.equal(requests.length, 3);
  assert.ok(requests.every((req) => req.input?.[2]?.content?.length <= 10_000));
  assert.deepEqual(
    facts.map((fact) => fact.label),
    ["fact-1", "fact-2", "fact-3"]
  );
  assert.deepEqual(
    facts.map((fact) => fact.chunkIndex),
    [0, 1, 2]
  );
});

test("deduplicates identical facts across chunks", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const requests = [];

  const duplicateFact = {
    type: "PRA_PCA_FACT",
    category: "SERVICE",
    label: "duplicate",
    data: { label: "duplicate" },
    source: "p1",
    confidence: 0.8,
  };

  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);

    return {
      ok: true,
      json: async () => ({
        output: [
          {
            content: [
              {
                json: {
                  facts: [duplicateFact],
                },
              },
            ],
          },
        ],
      }),
    };
  };

  const facts = await analyzeExtractedFacts({
    text: "X".repeat(25_000),
    documentName: "doc.txt",
    docType: "ARCHI",
  });

  assert.equal(requests.length, 3);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].label, "duplicate");
  assert.equal(facts[0].chunkIndex, 0);
});
