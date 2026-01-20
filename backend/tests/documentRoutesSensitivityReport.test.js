require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTestApp, getOrCreateDelegate, withServer } = require("./testUtils");

const documentRoutesModule = require("../src/routes/documentRoutes");
const documentRoutes = documentRoutesModule.default ?? documentRoutesModule;

const prismaModule = require("../src/prismaClient");
const prisma = prismaModule.default ?? prismaModule;

function setupDocumentMocks(t, tenantId) {
  const documentDelegate = getOrCreateDelegate(prisma, "document");
  const reportDelegate = getOrCreateDelegate(prisma, "documentSensitivityReport");

  const originalDocumentFindFirst = documentDelegate.findFirst;
  const originalReportFindFirst = reportDelegate.findFirst;

  documentDelegate.findFirst = async ({ where }) => {
    if (where.id !== "doc-1" || where.tenantId !== tenantId) return null;
    return { id: "doc-1", tenantId, isSensitive: true, protectionStatus: "PROTECTED" };
  };

  reportDelegate.findFirst = async ({ where }) => {
    if (where.documentId !== "doc-1" || where.tenantId !== tenantId) return null;
    return {
      id: "report-1",
      tenantId,
      documentId: "doc-1",
      status: "COMPLETED",
      findings: [{ type: "IBAN", count: 1 }],
      totalFindings: 1,
      scannedAt: new Date("2025-01-01T00:00:00.000Z"),
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    };
  };

  t.after(() => {
    documentDelegate.findFirst = originalDocumentFindFirst;
    reportDelegate.findFirst = originalReportFindFirst;
  });
}

test("GET /documents/:id/sensitivity-report retourne le rapport", async (t) => {
  const tenantId = "tenant-report";
  setupDocumentMocks(t, tenantId);

  const app = createTestApp(documentRoutes, "/documents", {
    tenantId,
    apiRole: "READER",
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/documents/doc-1/sensitivity-report`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.documentId, "doc-1");
    assert.equal(payload.totalFindings, 1);
    assert.equal(payload.alert.hasFindings, true);
  });
});
