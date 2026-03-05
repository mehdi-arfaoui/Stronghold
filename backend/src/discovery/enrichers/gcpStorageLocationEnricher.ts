import type { Enricher, EnrichmentResult } from "./types.js";
import { getNodeMetadata, readString, setNodeMetadata } from "./types.js";

function inferLocationType(location: string): string {
  const normalized = location.trim().toUpperCase();
  if (normalized === "US" || normalized === "EU" || normalized === "ASIA") {
    return "multi-region";
  }
  if (normalized.includes("+")) {
    return "dual-region";
  }
  if (/^[A-Z]{2,6}\d$/.test(normalized)) {
    return "dual-region";
  }
  return "region";
}

export const gcpStorageLocationEnricher: Enricher = {
  name: "gcp-storage-location",
  provider: "gcp",
  appliesTo: (node) =>
    node.provider === "gcp" &&
    (node.type === "OBJECT_STORAGE" || node.type === "STORAGE"),

  enrich: async (nodes): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;

    for (const node of nodes) {
      const metadata = getNodeMetadata(node);
      const locationType = readString(metadata.locationType);
      const location = readString(metadata.location);

      if (locationType) {
        setNodeMetadata(node, {
          locationType: locationType.toLowerCase(),
          location,
        });
      } else if (location) {
        setNodeMetadata(node, {
          locationType: inferLocationType(location),
          locationTypeInferred: true,
          location,
        });
      } else {
        setNodeMetadata(node, {
          locationType: null,
          location: null,
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
