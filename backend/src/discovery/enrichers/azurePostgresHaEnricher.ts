import type { Enricher, EnrichmentResult } from "./types.js";
import { getNodeMetadata, isRecord, readString, setNodeMetadata } from "./types.js";

function resolveHaMode(metadata: Record<string, unknown>): string | null {
  const highAvailability =
    isRecord(metadata.highAvailability) ? metadata.highAvailability : null;
  const mode =
    readString(metadata.highAvailabilityMode) ||
    readString(metadata.haMode) ||
    (highAvailability ? readString(highAvailability.mode) : null);
  return mode;
}

export const azurePostgresHaEnricher: Enricher = {
  name: "azure-postgres-ha",
  provider: "azure",
  appliesTo: (node) => {
    if (node.provider !== "azure" || node.type !== "DATABASE") return false;
    const metadata = getNodeMetadata(node);
    const sourceType = String(metadata.sourceType || "").toLowerCase();
    const engine = String(metadata.engine || "").toLowerCase();
    return sourceType.includes("postgres") || engine.includes("postgres");
  },

  enrich: async (nodes): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;

    for (const node of nodes) {
      const metadata = getNodeMetadata(node);
      setNodeMetadata(node, {
        haMode: resolveHaMode(metadata),
      });
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
