import assert from "node:assert/strict";
import test from "node:test";

import type { InfraNodeAttrs } from "../src/graph/types.ts";
import { enrichAllNodes } from "../src/discovery/enrichers/index.ts";

test("enrichAllNodes skips enrichers when provider credentials are missing", async () => {
  const nodes: InfraNodeAttrs[] = [
    {
      id: "aws-vm-1",
      name: "vm-1",
      type: "VM",
      provider: "aws",
      tags: {},
      metadata: {
        autoScalingGroupName: "asg-web",
      },
    },
    {
      id: "azure-db-1",
      name: "sql-1",
      type: "DATABASE",
      provider: "azure",
      tags: {},
      metadata: {
        sourceType: "AZURE_SQL_DATABASE",
        geoReplicationLinks: 1,
      },
    },
    {
      id: "gcp-cache-1",
      name: "redis-1",
      type: "CACHE",
      provider: "gcp",
      tags: {},
      metadata: {
        tier: "standard_ha",
      },
    },
  ];

  const results = await enrichAllNodes(nodes, {});

  assert.equal(Object.keys(results).length, 9);
  assert.equal(results["aws-ec2-asg"]?.enriched, 0);
  assert.equal(results["aws-ec2-asg"]?.failed, 0);
  assert.equal(results["aws-ec2-asg"]?.skipped, 1);
  assert.equal(results["azure-sql-geo-replication"]?.skipped, 1);
  assert.equal(results["gcp-memorystore-tier"]?.skipped, 1);
  assert.equal(nodes[0]?.metadata.autoScalingGroupName, "asg-web");
});
