const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTestApp, getOrCreateDelegate, withServer } = require("./testUtils");

const exerciseRoutesModule = require("../src/routes/exerciseRoutes.ts");
const exerciseRoutes = exerciseRoutesModule.default ?? exerciseRoutesModule;

const prismaModule = require("../src/prismaClient.ts");
const prisma = prismaModule.default ?? prismaModule;

test("POST /exercises plans a test and seeds checklist items", async (t) => {
  const scenarioDelegate = getOrCreateDelegate(prisma, "scenario");
  const runbookDelegate = getOrCreateDelegate(prisma, "runbook");
  const runbookStepDelegate = getOrCreateDelegate(prisma, "runbookStep");
  const exerciseDelegate = getOrCreateDelegate(prisma, "exercise");
  const originalScenarioFind = scenarioDelegate.findFirst;
  const originalRunbookFindMany = runbookDelegate.findMany;
  const originalRunbookStepFindMany = runbookStepDelegate.findMany;
  const originalTransaction = prisma.$transaction;
  const originalExerciseFindFirst = exerciseDelegate.findFirst;

  const scenario = { id: "scenario-1", title: "Cyber attaque", rtoTargetHours: 4 };
  const runbook = { id: "runbook-1", title: "Runbook" };
  const steps = [
    {
      id: "step-1",
      order: 1,
      title: "Isoler le service",
      description: "Couper l'accès",
      role: "Ops",
      blocking: true,
      scenarioId: "scenario-1",
    },
  ];

  let checklistCreates = [];

  scenarioDelegate.findFirst = async () => scenario;
  runbookDelegate.findMany = async () => [runbook];
  runbookStepDelegate.findMany = async () => steps;
  prisma.$transaction = async (callback) => {
    const tx = {
      exercise: {
        create: async ({ data }) => ({ id: "exercise-1", ...data }),
      },
      exerciseRunbook: {
        createMany: async () => undefined,
      },
      exerciseChecklistItem: {
        createMany: async ({ data }) => {
          checklistCreates = data;
        },
      },
    };
    return callback(tx);
  };

  exerciseDelegate.findFirst = async () => ({
    id: "exercise-1",
    title: "Test de reprise",
    description: null,
    scheduledAt: new Date("2024-06-15T10:00:00.000Z"),
    status: "PLANNED",
    scenario,
    runbooks: [{ runbook }],
    checklistItems: checklistCreates.map((item) => ({
      ...item,
      id: `item-${item.order}`,
      isCompleted: false,
    })),
  });

  t.after(() => {
    scenarioDelegate.findFirst = originalScenarioFind;
    runbookDelegate.findMany = originalRunbookFindMany;
    runbookStepDelegate.findMany = originalRunbookStepFindMany;
    prisma.$transaction = originalTransaction;
    exerciseDelegate.findFirst = originalExerciseFindFirst;
  });

  const app = createTestApp(exerciseRoutes, "/exercises");

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/exercises`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Test de reprise",
        scenarioId: "scenario-1",
        scheduledAt: "2024-06-15T10:00:00.000Z",
        runbookIds: ["runbook-1"],
      }),
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.status, "PLANNED");
    assert.equal(payload.checklistItems.length, 1);
    assert.equal(payload.scenario.id, "scenario-1");
  });
});
