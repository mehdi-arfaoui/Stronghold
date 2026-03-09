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
  const originalServiceFindMany = serviceDelegate.findMany;
  const originalServiceCreateMany = serviceDelegate.createMany;
  const originalInfraFindMany = infraDelegate.findMany;
  const originalInfraCreateMany = infraDelegate.createMany;
  const originalDependencyFindMany = dependencyDelegate.findMany;
  const originalDependencyCreateMany = dependencyDelegate.createMany;
  const originalLinkFindMany = linkDelegate.findMany;
  const originalLinkCreateMany = linkDelegate.createMany;

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
  const serviceByName = new Map([["Existing Service", "service-existing"]]);
  const infraByKey = new Map();

  prisma.$transaction = async (callback) => callback(prisma);

  serviceDelegate.findMany = async ({ where }) => {
    serviceWhereCalls.push(where);
    const names = where?.name?.in || [];
    return names
      .filter((name) => serviceByName.has(name))
      .map((name) => ({ id: serviceByName.get(name), name }));
  };
  serviceDelegate.createMany = async ({ data }) => {
    serviceCreateCalls.push(...data);
    let created = 0;
    for (const item of data) {
      if (serviceByName.has(item.name)) continue;
      created += 1;
      serviceByName.set(item.name, `service-${serviceByName.size + 1}`);
    }
    return { count: created };
  };
  infraDelegate.findMany = async ({ where }) => {
    infraWhereCalls.push(where);
    const matchers = Array.isArray(where?.OR) ? where.OR : [];
    return matchers
      .map((matcher) => {
        const key = `${matcher.name}::${matcher.type}`;
        const id = infraByKey.get(key);
        return id ? { id, name: matcher.name, type: matcher.type } : null;
      })
      .filter(Boolean);
  };
  infraDelegate.createMany = async ({ data }) => {
    infraCreateCalls.push(...data);
    let created = 0;
    for (const item of data) {
      const key = `${item.name}::${item.type}`;
      if (infraByKey.has(key)) continue;
      created += 1;
      infraByKey.set(key, `infra-${infraByKey.size + 1}`);
    }
    return { count: created };
  };
  dependencyDelegate.findMany = async ({ where }) => {
    dependencyWhereCalls.push(where);
    const fromIds = new Set(where?.fromServiceId?.in || []);
    const toIds = new Set(where?.toServiceId?.in || []);
    const dependencyTypes = new Set(where?.dependencyType?.in || []);
    return [...dependencyKeys]
      .map((key) => {
        const [fromServiceId, toServiceId, dependencyType] = key.split("::");
        if (!fromIds.has(fromServiceId) || !toIds.has(toServiceId) || !dependencyTypes.has(dependencyType)) {
          return null;
        }
        return { fromServiceId, toServiceId, dependencyType };
      })
      .filter(Boolean);
  };
  dependencyDelegate.createMany = async ({ data }) => {
    dependencyCreateCalls.push(...data);
    let created = 0;
    for (const item of data) {
      const key = `${item.fromServiceId}::${item.toServiceId}::${item.dependencyType}`;
      if (dependencyKeys.has(key)) continue;
      dependencyKeys.add(key);
      created += 1;
    }
    return { count: created };
  };
  linkDelegate.findMany = async ({ where }) => {
    linkWhereCalls.push(where);
    const serviceIds = new Set(where?.serviceId?.in || []);
    const infraIds = new Set(where?.infraId?.in || []);
    return [...linkKeys]
      .map((key) => {
        const [serviceId, infraId] = key.split("::");
        if (!serviceIds.has(serviceId) || !infraIds.has(infraId)) {
          return null;
        }
        return { serviceId, infraId };
      })
      .filter(Boolean);
  };
  linkDelegate.createMany = async ({ data }) => {
    linkCreateCalls.push(...data);
    let created = 0;
    for (const item of data) {
      const key = `${item.serviceId}::${item.infraId}`;
      if (linkKeys.has(key)) continue;
      linkKeys.add(key);
      created += 1;
    }
    return { count: created };
  };

  t.after(() => {
    prisma.$transaction = originalTransaction;
    serviceDelegate.findMany = originalServiceFindMany;
    serviceDelegate.createMany = originalServiceCreateMany;
    infraDelegate.findMany = originalInfraFindMany;
    infraDelegate.createMany = originalInfraCreateMany;
    dependencyDelegate.findMany = originalDependencyFindMany;
    dependencyDelegate.createMany = originalDependencyCreateMany;
    linkDelegate.findMany = originalLinkFindMany;
    linkDelegate.createMany = originalLinkCreateMany;
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
    createdInfraLinks: 1,
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
