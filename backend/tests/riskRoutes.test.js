require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTestApp, getOrCreateDelegate, withServer } = require("./testUtils");

const riskRoutesModule = require("../src/routes/riskRoutes");
const riskRoutes = riskRoutesModule.default ?? riskRoutesModule;
const { __test__ } = riskRoutesModule;

const prismaModule = require("../src/prismaClient");
const prisma = prismaModule.default ?? prismaModule;

test("risk scoring maps score to level", () => {
  const score = __test__.riskScore(4, 3);
  const level = __test__.riskLevel(score);

  assert.equal(score, 12);
  assert.equal(level, "high");
});

test("POST /risks returns score and level", async (t) => {
  const serviceDelegate = getOrCreateDelegate(prisma, "service");
  const riskDelegate = getOrCreateDelegate(prisma, "risk");
  const originalFindService = serviceDelegate.findFirst;
  const originalCreateRisk = riskDelegate.create;

  serviceDelegate.findFirst = async () => ({ id: "service-1", name: "Service A" });
  riskDelegate.create = async ({ data }) => ({
    id: "risk-1",
    tenantId: data.tenantId,
    title: data.title,
    description: data.description ?? null,
    threatType: data.threatType,
    probability: data.probability,
    impact: data.impact,
    status: data.status ?? null,
    owner: data.owner ?? null,
    processName: data.processName ?? null,
    serviceId: data.serviceId ?? null,
    mitigations: [],
    service: { id: "service-1", name: "Service A" },
  });

  t.after(() => {
    serviceDelegate.findFirst = originalFindService;
    riskDelegate.create = originalCreateRisk;
  });

  const app = createTestApp(riskRoutes, "/risks");

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/risks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Panne fournisseur",
        threatType: "supplier",
        probability: 4,
        impact: 3,
        serviceId: "service-1",
      }),
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.score, 12);
    assert.equal(payload.level, "high");
  });
});
