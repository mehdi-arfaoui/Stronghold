const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  analyzeExtractedFacts,
  OpenAiCallError,
} = require("../src/ai/extractedFactsAnalyzer.ts");

process.env.OPENAI_API_KEY = "test-key";

test("retries and surfaces controlled error on OpenAI 500", async (t) => {
  const originalFetch = global.fetch;
  let attempts = 0;

  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => {
    attempts += 1;
    return {
      ok: false,
      status: 500,
      statusText: "Server error",
      text: async () => "server error",
    };
  };

  await assert.rejects(
    () =>
      analyzeExtractedFacts({
        text: "contenu minimal",
        correlationId: "corr-500",
        retryConfig: {
          maxAttempts: 2,
          initialDelayMs: 1,
          maxDelayMs: 2,
          chunkTimeoutMs: 25,
        },
      }),
    (err) => {
      assert.ok(err instanceof OpenAiCallError);
      assert.equal(err.status, 500);
      assert.equal(err.correlationId, "corr-500");
      assert.match(err.message, /OpenAI request failed/);
      return true;
    }
  );

  assert.equal(attempts, 2);
});

test("surfaces controlled error on persistent OpenAI 429", async (t) => {
  const originalFetch = global.fetch;
  let attempts = 0;

  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => {
    attempts += 1;
    return {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "rate limited",
    };
  };

  await assert.rejects(
    () =>
      analyzeExtractedFacts({
        text: "contenu minimal",
        correlationId: "corr-429",
        retryConfig: {
          maxAttempts: 2,
          initialDelayMs: 1,
          maxDelayMs: 2,
          chunkTimeoutMs: 25,
        },
      }),
    (err) => {
      assert.ok(err instanceof OpenAiCallError);
      assert.equal(err.status, 429);
      assert.equal(err.correlationId, "corr-429");
      assert.match(err.message, /correlationId=corr-429/);
      return true;
    }
  );

  assert.equal(attempts, 2);
});
