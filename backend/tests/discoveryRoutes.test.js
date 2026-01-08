require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createTestApp, getOrCreateDelegate, withServer } = require("./testUtils");

const discoveryRoutesModule = require("../src/routes/discoveryRoutes");
const discoveryRoutes = discoveryRoutesModule.default ?? discoveryRoutesModule;

const prismaModule = require("../src/prismaClient");
const prisma = prismaModule.default ?? prismaModule;

function loadFixture(name) {
  return readFileSync(path.join(__dirname, "fixtures", name));
}

function setupDiscoveryJobMocks(t, tenantId) {
  const discoveryJobDelegate = getOrCreateDelegate(prisma, "discoveryJob");
  const originalCreate = discoveryJobDelegate.create;
  const originalUpdateMany = discoveryJobDelegate.updateMany;
  const originalFindFirst = discoveryJobDelegate.findFirst;
  const updateCalls = [];
  const findCalls = [];
  const createCalls = [];

  discoveryJobDelegate.create = async ({ data }) => {
    createCalls.push(data);
    return {
      id: "job-1",
      tenantId: data.tenantId,
      status: data.status,
      jobType: data.jobType,
      progress: data.progress,
      step: data.step ?? null,
      parameters: data.parameters ?? null,
      resultSummary: null,
      errorMessage: null,
      requestedByApiKeyId: data.requestedByApiKeyId ?? null,
      startedAt: data.startedAt ?? new Date(),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  discoveryJobDelegate.updateMany = async ({ where, data }) => {
    updateCalls.push({ where, data });
    return { count: 1 };
  };
  discoveryJobDelegate.findFirst = async ({ where }) => {
    findCalls.push(where);
    return {
      id: "job-1",
      tenantId: where.tenantId,
      status: "COMPLETED",
      jobType: "IMPORT",
      progress: 100,
      step: "COMPLETED",
      parameters: JSON.stringify({ filename: "import.csv", contentType: "text/csv" }),
      resultSummary: JSON.stringify({
        createdServices: 0,
        createdInfra: 0,
        createdDependencies: 0,
        createdInfraLinks: 0,
        ignoredEdges: 0,
        importReport: { rejectedRows: 0, rejectedEntries: [] },
      }),
      errorMessage: null,
      requestedByApiKeyId: null,
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };

  t.after(() => {
    discoveryJobDelegate.create = originalCreate;
    discoveryJobDelegate.updateMany = originalUpdateMany;
    discoveryJobDelegate.findFirst = originalFindFirst;
  });

  return { updateCalls, findCalls, createCalls };
}

function setupTransactionMock(t) {
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = async (callback) => callback(prisma);
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });
}

function setupDiscoveryImportMocks(t) {
  const serviceDelegate = getOrCreateDelegate(prisma, "service");
  const infraDelegate = getOrCreateDelegate(prisma, "infraComponent");
  const dependencyDelegate = getOrCreateDelegate(prisma, "serviceDependency");
  const linkDelegate = getOrCreateDelegate(prisma, "serviceInfraLink");

  const originalServiceFindFirst = serviceDelegate.findFirst;
  const originalServiceCreate = serviceDelegate.create;
  const originalInfraFindFirst = infraDelegate.findFirst;
  const originalInfraCreate = infraDelegate.create;
  const originalDependencyFindFirst = dependencyDelegate.findFirst;
  const originalDependencyCreate = dependencyDelegate.create;
  const originalLinkFindFirst = linkDelegate.findFirst;
  const originalLinkCreate = linkDelegate.create;

  serviceDelegate.findFirst = async () => null;
  serviceDelegate.create = async ({ data }) => ({ id: `service-${data.name}` });
  infraDelegate.findFirst = async () => null;
  infraDelegate.create = async ({ data }) => ({ id: `infra-${data.name}` });
  dependencyDelegate.findFirst = async () => null;
  dependencyDelegate.create = async () => ({ id: "dependency-1" });
  linkDelegate.findFirst = async () => null;
  linkDelegate.create = async () => ({ id: "link-1" });

  t.after(() => {
    serviceDelegate.findFirst = originalServiceFindFirst;
    serviceDelegate.create = originalServiceCreate;
    infraDelegate.findFirst = originalInfraFindFirst;
    infraDelegate.create = originalInfraCreate;
    dependencyDelegate.findFirst = originalDependencyFindFirst;
    dependencyDelegate.create = originalDependencyCreate;
    linkDelegate.findFirst = originalLinkFindFirst;
    linkDelegate.create = originalLinkCreate;
  });
}

test("POST /discovery/import accepte un CSV fixture et respecte le tenantId", async (t) => {
  const tenantId = "tenant-csv";
  setupTransactionMock(t);
  setupDiscoveryImportMocks(t);
  const { updateCalls, findCalls, createCalls } = setupDiscoveryJobMocks(t, tenantId);

  const app = createTestApp(discoveryRoutes, "/discovery", {
    tenantId,
    apiRole: "ADMIN",
  });

  const formData = new FormData();
  const csvBuffer = loadFixture("discovery-import.csv");
  formData.append("file", new Blob([csvBuffer], { type: "text/csv" }), "import.csv");

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/discovery/import`, {
      method: "POST",
      body: formData,
    });

    assert.equal(response.status, 201);
  });

  assert.ok(createCalls.every((data) => data.tenantId === tenantId));
  assert.ok(updateCalls.every((call) => call.where.tenantId === tenantId));
  assert.ok(findCalls.every((where) => where.tenantId === tenantId));
});

test("POST /discovery/import accepte un JSON fixture", async (t) => {
  setupTransactionMock(t);
  setupDiscoveryImportMocks(t);
  setupDiscoveryJobMocks(t, "tenant-json");

  const app = createTestApp(discoveryRoutes, "/discovery", {
    tenantId: "tenant-json",
    apiRole: "ADMIN",
  });

  const formData = new FormData();
  const jsonBuffer = loadFixture("discovery-import.json");
  formData.append("file", new Blob([jsonBuffer], { type: "application/json" }), "import.json");

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/discovery/import`, {
      method: "POST",
      body: formData,
    });

    assert.equal(response.status, 201);
  });
});
