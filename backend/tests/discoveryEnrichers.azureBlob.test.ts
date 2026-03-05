import assert from "node:assert/strict";
import test from "node:test";

import type { InfraNodeAttrs } from "../src/graph/types.ts";
import { azureBlobReplicationEnricher } from "../src/discovery/enrichers/azureBlobReplicationEnricher.ts";

test("azureBlobReplicationEnricher normalizes replication metadata", async () => {
  const nodes: InfraNodeAttrs[] = [
    {
      id: "azure-storage-1",
      name: "storage-account-1",
      type: "OBJECT_STORAGE",
      provider: "azure",
      tags: {},
      metadata: {
        skuName: "Standard_GRS",
        kind: "StorageV2",
      },
    },
    {
      id: "azure-storage-2",
      name: "storage-account-2",
      type: "OBJECT_STORAGE",
      provider: "azure",
      tags: {},
      metadata: {},
    },
  ];

  const result = await azureBlobReplicationEnricher.enrich(nodes, {});

  assert.equal(result.enriched, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);
  assert.equal(nodes[0]?.metadata.replication, "Standard_GRS");
  assert.equal(nodes[0]?.metadata.replicationType, "GRS");
  assert.equal(nodes[0]?.metadata.storageKind, "StorageV2");
  assert.equal(nodes[1]?.metadata.replication, null);
  assert.equal(nodes[1]?.metadata.replicationType, null);
});
