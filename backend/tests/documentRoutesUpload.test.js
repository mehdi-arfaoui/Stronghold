require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTestApp, getOrCreateDelegate, withServer } = require("./testUtils");

const documentRoutesModule = require("../src/routes/documentRoutes");
const documentRoutes = documentRoutesModule.default ?? documentRoutesModule;

const prismaModule = require("../src/prismaClient");
const prisma = prismaModule.default ?? prismaModule;

const s3Client = require("../src/clients/s3Client");
const sensitiveModule = require("../src/services/sensitiveDataScanService");

function setupUploadMocks(t, tenantId) {
  const documentDelegate = getOrCreateDelegate(prisma, "document");
  const originalFindFirst = documentDelegate.findFirst;
  const originalCreate = documentDelegate.create;
  const originalUpload = s3Client.uploadObjectToBucket;
  const originalSignedUrl = s3Client.getSignedUrlForObject;
  const originalSignedUploadUrl = s3Client.getSignedUploadUrlForObject;
  const originalScan = sensitiveModule.scanSensitiveDataOnUpload;

  documentDelegate.findFirst = async ({ where }) => {
    if (where.tenantId !== tenantId) return null;
    return null;
  };

  documentDelegate.create = async ({ data }) => ({
    id: "doc-1",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    ...data,
  });

  let uploadCalled = false;
  s3Client.uploadObjectToBucket = async () => {
    uploadCalled = true;
  };
  s3Client.getSignedUrlForObject = async () => "https://signed.example.com/doc-1";
  s3Client.getSignedUploadUrlForObject = async () => ({
    url: "https://signed.example.com/upload",
    expiresIn: 900,
  });

  sensitiveModule.scanSensitiveDataOnUpload = async () => ({
    blockedTypes: [],
    findings: [],
  });

  t.after(() => {
    documentDelegate.findFirst = originalFindFirst;
    documentDelegate.create = originalCreate;
    s3Client.uploadObjectToBucket = originalUpload;
    s3Client.getSignedUrlForObject = originalSignedUrl;
    s3Client.getSignedUploadUrlForObject = originalSignedUploadUrl;
    sensitiveModule.scanSensitiveDataOnUpload = originalScan;
  });

  return () => uploadCalled;
}

test("POST /documents/presign valide les paramètres", async (t) => {
  setupUploadMocks(t, "tenant-upload");

  const app = createTestApp(documentRoutes, "/documents", {
    tenantId: "tenant-upload",
    apiRole: "OPERATOR",
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/documents/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "doc.bin", mimeType: "application/x-foo", size: 10 }),
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.ok(payload.errors.some((err) => err.field === "mimeType"));
  });
});

test("POST /documents/presign retourne une URL signée", async (t) => {
  setupUploadMocks(t, "tenant-upload");

  const app = createTestApp(documentRoutes, "/documents", {
    tenantId: "tenant-upload",
    apiRole: "OPERATOR",
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/documents/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: "doc.txt",
        mimeType: "text/plain",
        size: 128,
      }),
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.uploadUrl, "https://signed.example.com/upload");
    assert.ok(payload.storagePath.startsWith("s3://"));
  });
});

test("POST /documents charge un fichier et renvoie un document", async (t) => {
  const wasUploadCalled = setupUploadMocks(t, "tenant-upload");

  const app = createTestApp(documentRoutes, "/documents", {
    tenantId: "tenant-upload",
    apiRole: "OPERATOR",
  });

  await withServer(app, async (baseUrl) => {
    const form = new FormData();
    form.append("file", new Blob(["Hello world"], { type: "text/plain" }), "sample.txt");
    form.append("docType", "archi");
    form.append("description", "Plan PRA");

    const response = await fetch(`${baseUrl}/documents`, {
      method: "POST",
      body: form,
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.docType, "ARCHI");
    assert.equal(payload.signedUrl, "https://signed.example.com/doc-1");
    assert.equal(payload.originalName, "sample.txt");
    assert.ok(wasUploadCalled());
  });
});
