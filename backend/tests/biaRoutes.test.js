require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTestApp, getOrCreateDelegate, withServer } = require("./testUtils");

const biaRoutesModule = require("../src/routes/biaRoutes");
const biaRoutes = biaRoutesModule.default ?? biaRoutesModule;
const { __test__ } = biaRoutesModule;

const prismaModule = require("../src/prismaClient");
const prisma = prismaModule.default ?? prismaModule;

test("bia scoring combines impact and time sensitivity", () => {
  const impactScore = __test__.scoreImpact(5, 3);
  const timeScore = __test__.scoreTimeSensitivity(4, 30, 8);
  const criticalityScore = __test__.scoreCriticality(impactScore, timeScore);

  assert.equal(impactScore, 4.2);
  assert.equal(timeScore, 4);
  assert.equal(criticalityScore, 4.1);
});

test("POST /bia/processes computes scores and links services", async (t) => {
  const serviceDelegate = getOrCreateDelegate(prisma, "service");
  const businessProcessDelegate = getOrCreateDelegate(prisma, "businessProcess");
  const originalFindMany = serviceDelegate.findMany;
  const originalCreate = businessProcessDelegate.create;

  serviceDelegate.findMany = async () => [{ id: "service-1" }];
  businessProcessDelegate.create = async ({ data }) => ({
    id: "process-1",
    tenantId: data.tenantId,
    name: data.name,
    impactScore: data.impactScore,
    criticalityScore: data.criticalityScore,
    services: data.services.create.map((entry) => ({
      service: { id: entry.serviceId, name: "Service A" },
    })),
  });

  t.after(() => {
    serviceDelegate.findMany = originalFindMany;
    businessProcessDelegate.create = originalCreate;
  });

  const app = createTestApp(biaRoutes, "/bia");

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/bia/processes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Facturation",
        description: "Processus critique",
        financialImpactLevel: 5,
        regulatoryImpactLevel: 3,
        rtoHours: 4,
        rpoMinutes: 30,
        mtpdHours: 8,
        serviceIds: ["service-1"],
      }),
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.impactScore, 4.2);
    assert.equal(payload.criticalityScore, 4.1);
    assert.equal(payload.services.length, 1);
  });
});
