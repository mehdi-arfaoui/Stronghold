import type { Enricher, EnrichmentResult } from "./types.js";
import { getNodeMetadata, isRecord, readString, setNodeMetadata } from "./types.js";

function resolveGeoReplicaLocation(link: unknown): string | null {
  if (!isRecord(link)) return null;
  const partnerServer = isRecord(link.partnerServer) ? link.partnerServer : null;
  return (
    readString(link.partnerLocation) ||
    readString(link.location) ||
    (partnerServer ? readString(partnerServer.location) : null)
  );
}

export const azureSqlGeoReplicationEnricher: Enricher = {
  name: "azure-sql-geo-replication",
  provider: "azure",
  appliesTo: (node) => {
    if (node.provider !== "azure" || node.type !== "DATABASE") return false;
    const metadata = getNodeMetadata(node);
    const sourceType = String(metadata.sourceType || "").toLowerCase();
    return sourceType.includes("azure_sql_database");
  },

  enrich: async (nodes): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;

    for (const node of nodes) {
      const metadata = getNodeMetadata(node);
      const geoLinks = metadata.geoReplicationLinks;

      if (Array.isArray(geoLinks) && geoLinks.length > 0) {
        const location = resolveGeoReplicaLocation(geoLinks[0]);
        setNodeMetadata(node, {
          geoReplicaLocation: location,
          hasGeoReplication: true,
        });
      } else if (typeof geoLinks === "number" && geoLinks > 0) {
        setNodeMetadata(node, {
          geoReplicaLocation: null,
          hasGeoReplication: true,
        });
      } else {
        setNodeMetadata(node, {
          geoReplicaLocation: null,
          hasGeoReplication: false,
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
