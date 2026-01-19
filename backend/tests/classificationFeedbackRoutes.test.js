require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTestApp, getOrCreateDelegate, withServer } = require("./testUtils");

const analysisRoutesModule = require("../src/routes/analysisRoutes");
const analysisRoutes = analysisRoutesModule.default ?? analysisRoutesModule;

const prismaModule = require("../src/prismaClient");
const prisma = prismaModule.default ?? prismaModule;

test("POST /analysis/documents/:id/classification-feedback updates fact", async (t) => {
  const tenantId = "tenant-feedback";
  const extractedFactDelegate = getOrCreateDelegate(prisma, "extractedFact");
  const documentDelegate = getOrCreateDelegate(prisma, "document");
  const userFeedbackDelegate = getOrCreateDelegate(prisma, "userFeedback");

  const originalFindMany = extractedFactDelegate.findMany;
  const originalFindFirst = extractedFactDelegate.findFirst;
  const originalUpdateMany = extractedFactDelegate.updateMany;
  const originalDocumentFindFirst = documentDelegate.findFirst;
  const originalUserFeedbackCreate = userFeedbackDelegate.create;

  const factRecord = {
    id: "fact-1",
    tenantId,
    documentId: "doc-1",
    type: "PRA_PCA_FACT",
    category: "SERVICE",
    label: "ERP",
    data: JSON.stringify({ service: "ERP" }),
    source: null,
    confidence: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  extractedFactDelegate.findMany = async () => [factRecord];

  let findFirstCalls = 0;
  extractedFactDelegate.findFirst = async () => {
    findFirstCalls += 1;
    if (findFirstCalls === 1) {
      return factRecord;
    }
    return {
      ...factRecord,
      category: "INFRA",
      label: "Infra corrigée",
      data: JSON.stringify({ service: "ERP", infra: "DC1" }),
      updatedAt: new Date(),
    };
  };

  const updateCalls = [];
  extractedFactDelegate.updateMany = async ({ where, data }) => {
    updateCalls.push({ where, data });
    return { count: 1 };
  };

  documentDelegate.findFirst = async ({ where }) => ({
    id: "doc-1",
    tenantId: where.tenantId,
    textContent: "Document de test",
    originalName: "test.txt",
    docType: "ARCHI",
  });
  userFeedbackDelegate.create = async () => ({});

  t.after(() => {
    extractedFactDelegate.findMany = originalFindMany;
    extractedFactDelegate.findFirst = originalFindFirst;
    extractedFactDelegate.updateMany = originalUpdateMany;
    documentDelegate.findFirst = originalDocumentFindFirst;
    userFeedbackDelegate.create = originalUserFeedbackCreate;
  });

  const app = createTestApp(analysisRoutes, "/analysis", {
    tenantId,
    apiRole: "OPERATOR",
  });

  await withServer(app, async (baseUrl) => {
    const extractedResponse = await fetch(
      `${baseUrl}/analysis/documents/doc-1/extracted-facts`,
      {
        method: "POST",
      }
    );

    assert.equal(extractedResponse.status, 200);

    const feedbackResponse = await fetch(
      `${baseUrl}/analysis/documents/doc-1/classification-feedback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factId: "fact-1",
          category: "infra",
          label: "Infra corrigée",
          infra: "DC1",
        }),
      }
    );

    assert.equal(feedbackResponse.status, 200);
    const payload = await feedbackResponse.json();
    assert.equal(payload.fact.category, "INFRA");
    assert.equal(payload.fact.infra, "DC1");
  });

  assert.ok(updateCalls.length > 0);
  assert.ok(updateCalls.every((call) => call.where.tenantId === tenantId));
});
