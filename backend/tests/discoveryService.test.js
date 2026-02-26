const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getOrCreateDelegate } = require("./testUtils");

const {
  parseDiscoveryImport,
  applyDiscoveryImport,
  encryptDiscoveryCredentials,
  DiscoveryImportError,
} = require("../src/services/discoveryService.ts");
const prismaModule = require("../src/prismaClient.ts");
const prisma = prismaModule.default ?? prismaModule;

test("parseDiscoveryImport accepte un CSV valide", () => {
  const csv = [
    "record_type,id,name,type,source,target,dependency_type",
    "node,svc-1,Service API,service,,,",
    "node,db-1,Database,postgres,,,",
    "edge,,,,svc-1,db-1,connexion",
  ].join("\n");

  const result = parseDiscoveryImport(Buffer.from(csv, "utf-8"), "import.csv", "text/csv");

  assert.equal(result.payload.nodes.length, 2);
  assert.equal(result.payload.edges.length, 1);
  assert.equal(result.report.rejectedRows, 0);
});

test("parseDiscoveryImport rejette un CSV sans les headers requis", () => {
  const csv = ["record_type,id,name,type,source,target", "node,svc-1,Service API,service,,"].join(
    "\n"
  );

  assert.throws(
    () => parseDiscoveryImport(Buffer.from(csv, "utf-8"), "import.csv", "text/csv"),
    (error) =>
      error instanceof DiscoveryImportError && error.message.includes("Header CSV invalide")
  );
});

test("parseDiscoveryImport accepte un JSON valide", () => {
  const json = JSON.stringify({
    nodes: [
      { id: "svc-1", name: "Service API", type: "service" },
      { id: "db-1", name: "Database", type: "postgres" },
    ],
    edges: [{ source: "svc-1", target: "db-1", dependency_type: "connexion" }],
  });

  const result = parseDiscoveryImport(Buffer.from(json, "utf-8"), "import.json", "application/json");

  assert.equal(result.payload.nodes[0].kind, "service");
  assert.equal(result.payload.nodes.length, 2);
  assert.equal(result.payload.edges.length, 1);
});

test("parseDiscoveryImport rejette un JSON invalide", () => {
  assert.throws(
    () => parseDiscoveryImport(Buffer.from("{", "utf-8"), "import.json", "application/json"),
    (error) => error instanceof DiscoveryImportError && error.message.includes("JSON invalide")
  );
});

test("applyDiscoveryImport crée services, infra et dépendances sans doublons et isole le tenant", async (t) => {
  const tenantId = "tenant-42";
  const serviceDelegate = getOrCreateDelegate(prisma, "service");
  const infraDelegate = getOrCreateDelegate(prisma, "infraComponent");
  const dependencyDelegate = getOrCreateDelegate(prisma, "serviceDependency");
  const linkDelegate = getOrCreateDelegate(prisma, "serviceInfraLink");

  const originalTransaction = prisma.$transaction;
  const originalServiceFindFirst = serviceDelegate.findFirst;
  const originalServiceCreate = serviceDelegate.create;
  const originalInfraFindFirst = infraDelegate.findFirst;
  const originalInfraCreate = infraDelegate.create;
  const originalDependencyFindFirst = dependencyDelegate.findFirst;
  const originalDependencyCreate = dependencyDelegate.create;
  const originalLinkFindFirst = linkDelegate.findFirst;
  const originalLinkCreate = linkDelegate.create;

  const serviceWhereCalls = [];
  const serviceCreateCalls = [];
  const infraWhereCalls = [];
  const infraCreateCalls = [];
  const dependencyWhereCalls = [];
  const dependencyCreateCalls = [];
  const linkWhereCalls = [];
  const linkCreateCalls = [];
  const dependencyKeys = new Set();
  const linkKeys = new Set();

  prisma.$transaction = async (callback) => callback(prisma);

  serviceDelegate.findFirst = async ({ where }) => {
    serviceWhereCalls.push(where);
    if (where.name === "Existing Service") {
      return { id: "service-existing" };
    }
    return null;
  };
  serviceDelegate.create = async ({ data }) => {
    serviceCreateCalls.push(data);
    return { id: `service-${serviceCreateCalls.length}` };
  };
  infraDelegate.findFirst = async ({ where }) => {
    infraWhereCalls.push(where);
    return null;
  };
  infraDelegate.create = async ({ data }) => {
    infraCreateCalls.push(data);
    return { id: `infra-${infraCreateCalls.length}` };
  };
  dependencyDelegate.findFirst = async ({ where }) => {
    dependencyWhereCalls.push(where);
    const key = `${where.fromServiceId}:${where.toServiceId}:${where.dependencyType}`;
    return dependencyKeys.has(key) ? { id: "dependency-existing" } : null;
  };
  dependencyDelegate.create = async ({ data }) => {
    dependencyCreateCalls.push(data);
    const key = `${data.fromServiceId}:${data.toServiceId}:${data.dependencyType}`;
    dependencyKeys.add(key);
    return { id: `dependency-${dependencyCreateCalls.length}` };
  };
  linkDelegate.findFirst = async ({ where }) => {
    linkWhereCalls.push(where);
    const key = `${where.serviceId}:${where.infraId}`;
    return linkKeys.has(key) ? { id: "link-existing" } : null;
  };
  linkDelegate.create = async ({ data }) => {
    linkCreateCalls.push(data);
    const key = `${data.serviceId}:${data.infraId}`;
    linkKeys.add(key);
    return { id: `link-${linkCreateCalls.length}` };
  };

  t.after(() => {
    prisma.$transaction = originalTransaction;
    serviceDelegate.findFirst = originalServiceFindFirst;
    serviceDelegate.create = originalServiceCreate;
    infraDelegate.findFirst = originalInfraFindFirst;
    infraDelegate.create = originalInfraCreate;
    dependencyDelegate.findFirst = originalDependencyFindFirst;
    dependencyDelegate.create = originalDependencyCreate;
    linkDelegate.findFirst = originalLinkFindFirst;
    linkDelegate.create = originalLinkCreate;
  });

  const payload = {
    nodes: [
      {
        externalId: "svc-1",
        name: "Service API",
        kind: "service",
        type: "service",
        criticality: "high",
        provider: null,
        location: null,
        ip: null,
        hostname: null,
        description: null,
      },
      {
        externalId: "svc-2",
        name: "Existing Service",
        kind: "service",
        type: "service",
        criticality: "critical",
        provider: null,
        location: null,
        ip: null,
        hostname: null,
        description: null,
      },
      {
        externalId: "infra-1",
        name: "Database",
        kind: "infra",
        type: "database",
        criticality: null,
        provider: "aws",
        location: "eu-west-1",
        ip: null,
        hostname: null,
        description: null,
      },
    ],
    edges: [
      { source: "svc-1", target: "svc-2", dependencyType: "http" },
      { source: "svc-1", target: "infra-1", dependencyType: "jdbc" },
      { source: "svc-1", target: "svc-2", dependencyType: "http" },
      { source: "infra-1", target: "svc-1", dependencyType: "db" },
      { source: "unknown", target: "svc-1", dependencyType: "ghost" },
    ],
  };

  const summary = await applyDiscoveryImport(tenantId, payload);

  assert.deepEqual(summary, {
    createdServices: 1,
    createdInfra: 1,
    createdDependencies: 1,
    createdInfraLinks: 2,
    ignoredEdges: 1,
  });

  assert.ok(serviceWhereCalls.every((where) => where.tenantId === tenantId));
  assert.ok(infraWhereCalls.every((where) => where.tenantId === tenantId));
  assert.ok(dependencyWhereCalls.every((where) => where.tenantId === tenantId));
  assert.ok(linkWhereCalls.every((where) => where.tenantId === tenantId));
  assert.ok(serviceCreateCalls.every((data) => data.tenantId === tenantId));
  assert.ok(infraCreateCalls.every((data) => data.tenantId === tenantId));
  assert.ok(dependencyCreateCalls.every((data) => data.tenantId === tenantId));
  assert.ok(linkCreateCalls.every((data) => data.tenantId === tenantId));
});

test("encryptDiscoveryCredentials produit un triplet chiffré non vide", () => {
  const result = encryptDiscoveryCredentials({ token: "abc" }, "super-secret");

  assert.ok(result.ciphertext.length > 0);
  assert.ok(result.iv.length > 0);
  assert.ok(result.tag.length > 0);
});
