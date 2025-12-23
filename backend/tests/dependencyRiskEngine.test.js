require("ts-node/register");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildDependencyRisks } = require("../src/analysis/dependencyRiskEngine");

const services = [
  {
    id: "svc-1",
    name: "Front",
    criticality: "critical",
    continuity: { rtoHours: 2, rpoMinutes: 15 },
  },
  {
    id: "svc-2",
    name: "DB",
    criticality: "low",
    continuity: { rtoHours: 6, rpoMinutes: 60 },
  },
];

const dependencies = [
  {
    id: "dep-1",
    fromServiceId: "svc-1",
    toServiceId: "svc-2",
    dependencyType: "forte",
    toService: services[1],
  },
];

test("buildDependencyRisks flags criticality and RTO/RPO mismatches", () => {
  const risks = buildDependencyRisks(services, dependencies);
  assert.equal(risks.length, 1);
  assert.equal(risks[0].riskLevel, "high");
  assert.ok(risks[0].risks.some((r) => r.includes("RTO")));
  assert.ok(risks[0].recommendations.length > 0);
});
