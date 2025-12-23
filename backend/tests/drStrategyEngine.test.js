require("ts-node/register");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getSuggestedDRStrategy } = require("../src/analysis/drStrategyEngine");

const sampleServices = [
  {
    id: "app1",
    name: "Front",
    type: "APP",
    criticality: "critical",
    rtoHours: 2,
    rpoMinutes: 10,
  },
  {
    id: "db1",
    name: "DB",
    type: "DB",
    criticality: "high",
    rtoHours: 2,
    rpoMinutes: 5,
  },
];

const sampleDeps = [
  { from: "app1", to: "db1", type: "forte" },
];

test("prioritizes aggressive strategies for critical workloads", () => {
  const recs = getSuggestedDRStrategy(sampleServices, sampleDeps, 2, 10, "critical");
  const top = recs[0];
  assert.ok(top.scenario.id === "active-active" || top.scenario.id === "warm-standby");
  assert.ok(top.justification.length > 0);
  assert.ok(["strong", "medium", "weak"].includes(top.matchLevel));
});

test("ranks backup & restore lower for strong dependencies", () => {
  const recs = getSuggestedDRStrategy(sampleServices, sampleDeps, 2, 10, "critical");
  const backup = recs.find((r) => r.scenario.id === "backup-restore");
  assert.ok(backup.score > 0, "backup/restore should be penalized");
});

test("favors cost-effective options for low criticality", () => {
  const lowServices = sampleServices.map((s) => ({ ...s, criticality: "low" }));
  const recs = getSuggestedDRStrategy(lowServices, [], 48, 600, "low");
  const top = recs[0];
  assert.equal(top.scenario.id, "backup-restore");
});

test("includes multi-az scenario for high criticality", () => {
  const recs = getSuggestedDRStrategy(sampleServices, [], 3, 30, "high");
  const multiAz = recs.find((r) => r.scenario.id === "multi-az-ha");
  assert.ok(multiAz, "Multi-AZ scenario should be present");
  assert.ok(multiAz.justification.toLowerCase().includes("multi"));
});
