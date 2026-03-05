import type { Enricher, EnrichmentResult } from "./types.js";
import { getNodeMetadata, isRecord, readString, setNodeMetadata } from "./types.js";

export const gcpMemorystoreTierEnricher: Enricher = {
  name: "gcp-memorystore-tier",
  provider: "gcp",
  appliesTo: (node) =>
    node.provider === "gcp" && node.type === "CACHE",

  enrich: async (nodes): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;

    for (const node of nodes) {
      const metadata = getNodeMetadata(node);
      const instance = isRecord(metadata.instance) ? metadata.instance : null;
      const tier = readString(metadata.tier) || (instance ? readString(instance.tier) : null);
      const memorySizeGb =
        typeof metadata.memorySizeGb === "number"
          ? metadata.memorySizeGb
          : instance && typeof instance.memorySizeGb === "number"
            ? instance.memorySizeGb
            : null;
      const redisVersion =
        readString(metadata.redisVersion) ||
        (instance ? readString(instance.redisVersion) : null);

      if (tier) {
        setNodeMetadata(node, {
          tier: tier.toUpperCase(),
          memorySizeGb,
          redisVersion,
        });
      } else {
        setNodeMetadata(node, {
          tier: null,
          memorySizeGb,
          redisVersion,
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
