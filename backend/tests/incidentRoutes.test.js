require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTestApp, getOrCreateDelegate, withServer } = require("./testUtils");

const incidentRoutesModule = require("../src/routes/incidentRoutes");
const incidentRoutes = incidentRoutesModule.default ?? incidentRoutesModule;
const notificationService = require("../src/services/incidentNotificationService");

const prismaModule = require("../src/prismaClient");
const prisma = prismaModule.default ?? prismaModule;

test("POST /incidents creates an incident and triggers notifications", async (t) => {
  const serviceDelegate = getOrCreateDelegate(prisma, "service");
  const documentDelegate = getOrCreateDelegate(prisma, "document");
  const incidentDelegate = getOrCreateDelegate(prisma, "incident");
  const originalServiceFindMany = serviceDelegate.findMany;
  const originalDocumentFindMany = documentDelegate.findMany;
  const originalIncidentCreate = incidentDelegate.create;
  const originalNotify = notificationService.notifyIncidentEvent;

  let notifyCalled = false;

  serviceDelegate.findMany = async () => [{ id: "service-1" }];
  documentDelegate.findMany = async () => [{ id: "doc-1" }];
  incidentDelegate.create = async ({ data }) => ({
    id: "incident-1",
    tenantId: data.tenantId,
    title: data.title,
    description: data.description ?? null,
    status: data.status,
    detectedAt: data.detectedAt,
    responsibleTeam: data.responsibleTeam ?? null,
    services: data.services.create.map((entry) => ({
      service: { id: entry.serviceId, name: "Service A", criticality: "HIGH", type: "APP" },
    })),
    documents: data.documents.create.map((entry) => ({
      document: { id: entry.documentId, originalName: "Plan.pdf", docType: "PDF" },
    })),
    actions: [
      {
        id: "action-1",
        actionType: "CREATED",
        description: "Incident créé",
        createdAt: new Date(),
      },
    ],
  });

  notificationService.notifyIncidentEvent = async () => {
    notifyCalled = true;
  };

  t.after(() => {
    serviceDelegate.findMany = originalServiceFindMany;
    documentDelegate.findMany = originalDocumentFindMany;
    incidentDelegate.create = originalIncidentCreate;
    notificationService.notifyIncidentEvent = originalNotify;
  });

  const app = createTestApp(incidentRoutes, "/incidents");

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/incidents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Incident ERP",
        status: "open",
        detectedAt: "2024-06-01T10:00:00.000Z",
        serviceIds: ["service-1"],
        documentIds: ["doc-1"],
      }),
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.status, "OPEN");
    assert.equal(payload.services.length, 1);
    assert.equal(payload.documents.length, 1);
  });

  assert.ok(notifyCalled, "Expected notifyIncidentEvent to be called");
});
