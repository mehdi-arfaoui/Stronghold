const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  deriveMetadataMappings,
} = require("../src/services/documentIntelligenceService.ts");

test("deriveMetadataMappings captures services, infra and dependencies", () => {
  const metadata = {
    services: ["Billing"],
    dependencies: ["Billing -> PostgreSQL cluster", "Billing depends on API Gateway"],
  };

  const mapping = deriveMetadataMappings(metadata);

  assert.ok(mapping.services.includes("Billing"), "Expected Billing service to be detected");

  const infraDep = mapping.dependencies.find((d) => d.to.toLowerCase().includes("postgresql"));
  assert.ok(infraDep?.targetIsInfra, "Expected PostgreSQL dependency to be tagged as infra");
  assert.ok(
    mapping.infra.some((i) => i.name.toLowerCase().includes("postgresql")),
    "Expected PostgreSQL infra component inference"
  );

  const serviceDep = mapping.dependencies.find((d) => d.to === "API Gateway");
  assert.ok(serviceDep, "Expected API Gateway dependency to be mapped");
  assert.equal(serviceDep?.from, "Billing");
  assert.equal(serviceDep?.targetIsInfra, false);
});
