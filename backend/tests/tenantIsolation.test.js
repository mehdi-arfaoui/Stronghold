const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTestApp, withServer } = require("./testUtils");

const documentRoutesModule = require("../src/routes/documentRoutes.ts");
const documentRoutes = documentRoutesModule.default ?? documentRoutesModule;

const scenarioRoutesModule = require("../src/routes/scenarioRoutes.ts");
const scenarioRoutes = scenarioRoutesModule.default ?? scenarioRoutesModule;

const analysisRoutesModule = require("../src/routes/analysisRoutes.ts");
const analysisRoutes = analysisRoutesModule.default ?? analysisRoutesModule;

async function expectTenantRequired(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.equal(payload.error, "Tenant not resolved");
}

test("documents endpoints require tenantId", async () => {
  const app = createTestApp(documentRoutes, "/documents", { tenantId: undefined });
  await withServer(app, async (baseUrl) => {
    await expectTenantRequired(baseUrl, "/documents");
  });
});

test("scenario endpoints require tenantId", async () => {
  const app = createTestApp(scenarioRoutes, "/scenarios", { tenantId: undefined });
  await withServer(app, async (baseUrl) => {
    await expectTenantRequired(baseUrl, "/scenarios");
  });
});

test("analysis endpoints require tenantId", async () => {
  const app = createTestApp(analysisRoutes, "/analysis", { tenantId: undefined });
  await withServer(app, async (baseUrl) => {
    await expectTenantRequired(baseUrl, "/analysis/basic");
  });
});
