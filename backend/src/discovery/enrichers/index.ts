import type { InfraNodeAttrs } from "../../graph/types.js";
import { appLogger } from "../../utils/logger.js";
import { awsDynamoDbPitrEnricher } from "./awsDynamoDbPitrEnricher.js";
import { awsEc2AsgEnricher } from "./awsEc2AsgEnricher.js";
import { awsElastiCacheFailoverEnricher } from "./awsElastiCacheFailoverEnricher.js";
import { awsS3ReplicationEnricher } from "./awsS3ReplicationEnricher.js";
import { azureBlobReplicationEnricher } from "./azureBlobReplicationEnricher.js";
import { azurePostgresHaEnricher } from "./azurePostgresHaEnricher.js";
import { azureSqlGeoReplicationEnricher } from "./azureSqlGeoReplicationEnricher.js";
import { gcpMemorystoreTierEnricher } from "./gcpMemorystoreTierEnricher.js";
import { gcpStorageLocationEnricher } from "./gcpStorageLocationEnricher.js";
import type {
  Enricher,
  EnrichmentResult,
  MetadataEnrichmentCredentials,
  MetadataEnrichmentRegions,
} from "./types.js";
import { toErrorMessage } from "./types.js";

const EMPTY_RESULT: EnrichmentResult = {
  enriched: 0,
  failed: 0,
  skipped: 0,
  durationMs: 0,
};

export const ALL_ENRICHERS: Enricher[] = [
  awsEc2AsgEnricher,
  awsS3ReplicationEnricher,
  awsDynamoDbPitrEnricher,
  awsElastiCacheFailoverEnricher,
  azureSqlGeoReplicationEnricher,
  azurePostgresHaEnricher,
  azureBlobReplicationEnricher,
  gcpStorageLocationEnricher,
  gcpMemorystoreTierEnricher,
];

async function runProviderEnrichers(
  provider: Enricher["provider"],
  nodes: InfraNodeAttrs[],
  enrichers: Enricher[],
  credentials: MetadataEnrichmentCredentials,
  regions: MetadataEnrichmentRegions | undefined,
  results: Record<string, EnrichmentResult>,
): Promise<void> {
  const providerCredentials = credentials[provider];
  if (!providerCredentials) {
    for (const enricher of enrichers) {
      const applicableNodes = nodes.filter(enricher.appliesTo);
      results[enricher.name] = {
        ...EMPTY_RESULT,
        skipped: applicableNodes.length,
      };
    }
    appLogger.debug("[MetadataEnrichment] Provider skipped (missing credentials)", {
      provider,
      enrichers: enrichers.length,
    });
    return;
  }

  for (const enricher of enrichers) {
    const applicableNodes = nodes.filter(enricher.appliesTo);
    if (applicableNodes.length === 0) {
      results[enricher.name] = { ...EMPTY_RESULT };
      continue;
    }

    const startedAt = Date.now();
    try {
      const rawResult = await enricher.enrich(
        applicableNodes,
        providerCredentials,
        regions?.[provider],
      );
      const durationMs =
        Number.isFinite(rawResult.durationMs) && rawResult.durationMs >= 0
          ? rawResult.durationMs
          : Date.now() - startedAt;
      const enriched =
        Number.isFinite(rawResult.enriched) && rawResult.enriched >= 0
          ? rawResult.enriched
          : 0;
      const failed =
        Number.isFinite(rawResult.failed) && rawResult.failed >= 0
          ? rawResult.failed
          : 0;
      const skipped =
        Number.isFinite(rawResult.skipped) && rawResult.skipped >= 0
          ? rawResult.skipped
          : Math.max(0, applicableNodes.length - enriched - failed);
      results[enricher.name] = {
        enriched,
        failed,
        skipped,
        durationMs,
      };
      appLogger.info("[MetadataEnrichment] Enricher completed", {
        provider,
        enricher: enricher.name,
        enriched,
        failed,
        skipped,
        durationMs,
      });
    } catch (error) {
      results[enricher.name] = {
        enriched: 0,
        failed: applicableNodes.length,
        skipped: 0,
        durationMs: Date.now() - startedAt,
      };
      appLogger.debug("[MetadataEnrichment] Enricher failed", {
        provider,
        enricher: enricher.name,
        message: toErrorMessage(error),
      });
    }
  }
}

export async function enrichAllNodes(
  nodes: InfraNodeAttrs[],
  credentials: MetadataEnrichmentCredentials,
  regions?: MetadataEnrichmentRegions,
): Promise<Record<string, EnrichmentResult>> {
  const results: Record<string, EnrichmentResult> = {};

  const byProvider: Record<Enricher["provider"], Enricher[]> = {
    aws: ALL_ENRICHERS.filter((enricher) => enricher.provider === "aws"),
    azure: ALL_ENRICHERS.filter((enricher) => enricher.provider === "azure"),
    gcp: ALL_ENRICHERS.filter((enricher) => enricher.provider === "gcp"),
  };

  await Promise.allSettled([
    runProviderEnrichers("aws", nodes, byProvider.aws, credentials, regions, results),
    runProviderEnrichers("azure", nodes, byProvider.azure, credentials, regions, results),
    runProviderEnrichers("gcp", nodes, byProvider.gcp, credentials, regions, results),
  ]);

  return results;
}

export type {
  Enricher,
  EnrichmentResult,
  MetadataEnrichmentContext,
  MetadataEnrichmentCredentials,
  MetadataEnrichmentRegions,
} from "./types.js";
