/**
 * Enriches ElastiCache nodes with replication group failover settings.
 */

import {
  DescribeReplicationGroupsCommand,
  ElastiCacheClient,
  type ReplicationGroup,
} from '@aws-sdk/client-elasticache';
import type { InfraNodeAttrs } from '../../../types/infrastructure.js';
import { resolveAwsCredentials } from '../aws-client-factory.js';
import type { DiscoveryCloudCredentials } from '../../../types/discovery.js';
import type { Enricher, EnrichmentResult } from './types.js';
import {
  getNodeMetadata,
  readString,
  resolveNodeRegion,
  setNodeMetadata,
  toErrorMessage,
} from './types.js';

function resolveReplicationGroupId(node: InfraNodeAttrs): string | null {
  const metadata = getNodeMetadata(node);
  return readString(metadata.replicationGroupId) ?? readString(metadata.replicationGroup);
}

function toEnabledFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').toLowerCase();
  return normalized === 'enabled' || normalized === 'true';
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
  const memberClusters = (group.MemberClusters ?? []).filter((item) => Boolean(item));
  setNodeMetadata(node, {
    automaticFailover: toEnabledFlag(group.AutomaticFailover),
    automaticFailoverStatus: group.AutomaticFailover ?? null,
    multiAZEnabled: toEnabledFlag(group.MultiAZ),
    clusterEnabled: typeof group.ClusterEnabled === 'boolean' ? group.ClusterEnabled : false,
    memberClusters: memberClusters.length,
  });
}

export const elasticacheFailoverEnricher: Enricher = {
  name: 'aws-elasticache-failover',
  provider: 'aws',
  appliesTo: (node) => node.provider === 'aws' && node.type === 'CACHE',

  enrich: async (nodes, credentials, region): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;
    let failed = 0;
    let skipped = 0;

    const clients = new Map<string, ElastiCacheClient>();
    const getClient = (awsRegion: string): ElastiCacheClient => {
      const existing = clients.get(awsRegion);
      if (existing) return existing;

      const creds = credentials as DiscoveryCloudCredentials;
      const resolved = resolveAwsCredentials(creds, awsRegion, 'stronghold-enrichment-elasticache');
      const client = new ElastiCacheClient({
        region: awsRegion,
        ...(resolved ? { credentials: resolved } : {}),
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
          automaticFailoverStatus: 'disabled',
          multiAZEnabled: false,
          clusterEnabled: false,
          memberClusters: 1,
        });
        enriched += 1;
        continue;
      }

      const regionMap = byRegionAndGroup.get(nodeRegion) ?? new Map<string, InfraNodeAttrs[]>();
      const currentNodes = regionMap.get(replicationGroupId) ?? [];
      currentNodes.push(node);
      regionMap.set(replicationGroupId, currentNodes);
      byRegionAndGroup.set(nodeRegion, regionMap);
    }

    for (const [awsRegion, regionMap] of byRegionAndGroup.entries()) {
      for (const groupId of regionMap.keys()) {
        const nodesForGroup = regionMap.get(groupId) ?? [];
        try {
          const response = await getClient(awsRegion).send(
            new DescribeReplicationGroupsCommand({ ReplicationGroupId: groupId }),
          );
          const group = (response.ReplicationGroups ?? [])[0];
          if (!group) {
            failed += nodesForGroup.length;
            for (const node of nodesForGroup) setUnknownFailoverMetadata(node);
            continue;
          }

          for (const node of nodesForGroup) {
            setFailoverMetadata(node, group);
            enriched += 1;
          }
        } catch (error) {
          failed += nodesForGroup.length;
          for (const node of nodesForGroup) setUnknownFailoverMetadata(node);
          void toErrorMessage(error);
        }
      }
    }

    const accounted = enriched + failed + skipped;
    if (accounted < nodes.length) {
      skipped += nodes.length - accounted;
    }

    return { enriched, failed, skipped, durationMs: Date.now() - start };
  },
};
