import {
  DescribeReplicationGroupsCommand,
  ElastiCacheClient,
  type ReplicationGroup,
} from "@aws-sdk/client-elasticache";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import type { InfraNodeAttrs } from "../../graph/types.js";
import { appLogger } from "../../utils/logger.js";
import type { Enricher, EnrichmentResult } from "./types.js";
import {
  getNodeMetadata,
  isAccessDeniedError,
  readString,
  resolveNodeRegion,
  setNodeMetadata,
  toErrorMessage,
} from "./types.js";

function resolveAwsClientCredentials(credentials: unknown, region: string): unknown {
  const awsCredentials =
    credentials && typeof credentials === "object"
      ? (credentials as Record<string, unknown>)
      : {};

  const roleArn = readString(awsCredentials.roleArn);
  const externalId = readString(awsCredentials.externalId);
  if (roleArn) {
    return fromTemporaryCredentials({
      params: {
        RoleArn: roleArn,
        RoleSessionName: "stronghold-enrichment-elasticache",
        ...(externalId ? { ExternalId: externalId } : {}),
      },
      clientConfig: { region },
    });
  }

  const accessKeyId = readString(awsCredentials.accessKeyId);
  const secretAccessKey = readString(awsCredentials.secretAccessKey);
  const sessionToken = readString(awsCredentials.sessionToken);
  if (accessKeyId && secretAccessKey) {
    return {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    };
  }

  return undefined;
}

function resolveReplicationGroupId(node: InfraNodeAttrs): string | null {
  const metadata = getNodeMetadata(node);
  return (
    readString(metadata.replicationGroupId) ||
    readString(metadata.replicationGroup)
  );
}

function toEnabledFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").toLowerCase();
  return normalized === "enabled" || normalized === "true";
}

function setUnknownFailoverMetadata(node: InfraNodeAttrs): void {
  setNodeMetadata(node, {
    automaticFailover: null,
    automaticFailoverStatus: null,
    multiAZEnabled: null,
    clusterEnabled: null,
    memberClusters: null,
  });
}

function setFailoverMetadata(node: InfraNodeAttrs, group: ReplicationGroup): void {
  const memberClusters = (group.MemberClusters || []).filter((item) => Boolean(item));
  setNodeMetadata(node, {
    automaticFailover: toEnabledFlag(group.AutomaticFailover),
    automaticFailoverStatus: group.AutomaticFailover || null,
    multiAZEnabled: toEnabledFlag(group.MultiAZ),
    clusterEnabled:
      typeof group.ClusterEnabled === "boolean" ? group.ClusterEnabled : false,
    memberClusters: memberClusters.length,
  });
}

export const awsElastiCacheFailoverEnricher: Enricher = {
  name: "aws-elasticache-failover",
  provider: "aws",
  appliesTo: (node) => node.provider === "aws" && node.type === "CACHE",

  enrich: async (
    nodes,
    credentials,
    region,
  ): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;
    let failed = 0;
    let skipped = 0;

    const clients = new Map<string, ElastiCacheClient>();
    const getClient = (awsRegion: string): ElastiCacheClient => {
      const existing = clients.get(awsRegion);
      if (existing) return existing;

      const clientCredentials = resolveAwsClientCredentials(credentials, awsRegion);
      const client = new ElastiCacheClient({
        region: awsRegion,
        ...(clientCredentials ? { credentials: clientCredentials as any } : {}),
      });
      clients.set(awsRegion, client);
      return client;
    };

    const byRegionAndGroup = new Map<string, Map<string, InfraNodeAttrs[]>>();
    for (const node of nodes) {
      const nodeRegion = resolveNodeRegion(node, region);
      if (!nodeRegion) {
        failed += 1;
        setUnknownFailoverMetadata(node);
        continue;
      }

      const replicationGroupId = resolveReplicationGroupId(node);
      if (!replicationGroupId) {
        setNodeMetadata(node, {
          automaticFailover: false,
          automaticFailoverStatus: "disabled",
          multiAZEnabled: false,
          clusterEnabled: false,
          memberClusters: 1,
        });
        enriched += 1;
        continue;
      }

      const regionMap = byRegionAndGroup.get(nodeRegion) || new Map<string, InfraNodeAttrs[]>();
      const currentNodes = regionMap.get(replicationGroupId) || [];
      currentNodes.push(node);
      regionMap.set(replicationGroupId, currentNodes);
      byRegionAndGroup.set(nodeRegion, regionMap);
    }

    for (const [awsRegion, regionMap] of byRegionAndGroup.entries()) {
      const groupIds = Array.from(regionMap.keys());
      for (const groupId of groupIds) {
        const nodesForGroup = regionMap.get(groupId) || [];
        try {
          const response = await getClient(awsRegion).send(
            new DescribeReplicationGroupsCommand({
              ReplicationGroupId: groupId,
            }),
          );
          const group = (response.ReplicationGroups || [])[0];
          if (!group) {
            failed += nodesForGroup.length;
            for (const node of nodesForGroup) {
              setUnknownFailoverMetadata(node);
            }
            continue;
          }

          for (const node of nodesForGroup) {
            setFailoverMetadata(node, group);
            enriched += 1;
          }
        } catch (error) {
          failed += nodesForGroup.length;
          for (const node of nodesForGroup) {
            setUnknownFailoverMetadata(node);
          }
          appLogger.debug("[MetadataEnrichment] aws-elasticache-failover failed", {
            replicationGroupId: groupId,
            region: awsRegion,
            accessDenied: isAccessDeniedError(error),
            message: toErrorMessage(error),
          });
        }
      }
    }

    const accounted = enriched + failed + skipped;
    if (accounted < nodes.length) {
      skipped += nodes.length - accounted;
    }

    return {
      enriched,
      failed,
      skipped,
      durationMs: Date.now() - start,
    };
  },
};
