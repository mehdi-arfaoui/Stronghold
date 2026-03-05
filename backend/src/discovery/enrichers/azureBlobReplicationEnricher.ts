import type { Enricher, EnrichmentResult } from "./types.js";
import { getNodeMetadata, isRecord, readString, setNodeMetadata } from "./types.js";

function resolveSkuName(metadata: Record<string, unknown>): string | null {
  const sku = isRecord(metadata.sku) ? metadata.sku : null;
  return readString(metadata.skuName) || (sku ? readString(sku.name) : null);
}

function parseReplicationType(skuName: string): string | null {
  const parts = skuName.split("_").filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  return parts[parts.length - 1] || null;
}

export const azureBlobReplicationEnricher: Enricher = {
  name: "azure-blob-replication",
  provider: "azure",
  appliesTo: (node) =>
    node.provider === "azure" &&
    (node.type === "OBJECT_STORAGE" || node.type === "STORAGE"),

  enrich: async (nodes): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;

    for (const node of nodes) {
      const metadata = getNodeMetadata(node);
      const skuName = resolveSkuName(metadata);
      const storageKind = readString(metadata.kind);

      if (skuName) {
        setNodeMetadata(node, {
          replication: skuName,
          replicationType: parseReplicationType(skuName),
          storageKind,
        });
      } else {
        setNodeMetadata(node, {
          replication: null,
          replicationType: null,
          storageKind,
        });
      }

      enriched += 1;
    }

    return {
      enriched,
      failed: 0,
      skipped: 0,
      durationMs: Date.now() - start,
    };
  },
};
