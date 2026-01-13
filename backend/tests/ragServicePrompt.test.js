require("ts-node/register");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { buildRagPrompt, draftAnswerFromContext } = require("../src/ai/ragService");

test("draftAnswerFromContext construit une réponse à partir du contexte", () => {
  const context = {
    chunks: [
      {
        documentId: "doc-1",
        documentName: "Plan PRA",
        documentType: "ARCHI",
        score: 0.9,
        text: "Le service ERP est critique avec un RTO de 4h.",
      },
    ],
    extractedFacts: [
      {
        id: "fact-1",
        documentId: "doc-1",
        label: "ERP",
        category: "SERVICE",
        dataPreview: "Service ERP critique",
        confidence: 0.8,
        score: 0.9,
      },
    ],
  };

  const answer = draftAnswerFromContext("Quels services critiques ?", context);

  assert.match(answer, /ERP/);
  assert.match(answer, /Question: Quels services critiques/);
});

test("buildRagPrompt injecte chunks et faits dans le prompt", () => {
  const context = {
    chunks: [
      {
        documentId: "doc-1",
        documentName: "Plan PRA",
        documentType: "ARCHI",
        score: 0.9,
        text: "Le service ERP est critique.",
      },
      {
        documentId: "doc-2",
        documentName: "BIA",
        documentType: "BIA",
        score: 0.6,
        text: "Le RPO attendu est 15 minutes.",
      },
    ],
    extractedFacts: [
      {
        id: "fact-1",
        documentId: "doc-1",
        label: "ERP",
        category: "SERVICE",
        dataPreview: "Service ERP critique",
        confidence: 0.8,
        score: 0.9,
      },
    ],
  };

  const { prompt, totalChars } = buildRagPrompt({
    question: "Quel plan de reprise pour ERP ?",
    context,
  });

  assert.ok(prompt.includes("[doc-1]"));
  assert.ok(prompt.includes("ERP"));
  assert.ok(prompt.includes("[doc=doc-1]"));
  assert.ok(totalChars > 0);
});
