/**
 * Enriches S3 nodes with versioning and replication configuration.
 */

import {
  GetBucketReplicationCommand,
  GetBucketVersioningCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { resolveAwsCredentials } from '../aws-client-factory.js';
import type { DiscoveryCloudCredentials } from '../../../types/discovery.js';
import type { Enricher, EnrichmentResult } from './types.js';
import {
  getNodeMetadata,
  isRecord,
  readString,
  resolveNodeRegion,
  setNodeMetadata,
  toErrorMessage,
} from './types.js';

function resolveBucketName(node: {
  id: string;
  resourceId: string | null | undefined;
  name: string;
  metadata: Record<string, unknown>;
}): string | null {
  const fromMetadata = readString(node.metadata.bucketName);
  if (fromMetadata) return fromMetadata;

  const fromResourceId = readString(node.resourceId);
  if (fromResourceId) {
    return fromResourceId;
  }

  const fromArn = readString(node.id);
  if (fromArn?.startsWith('arn:aws:s3:::')) {
    const bucketName = fromArn.slice('arn:aws:s3:::'.length).trim();
    if (bucketName.length > 0) return bucketName;
  }

  return readString(node.name);
}

function isReplicationConfigMissing(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const name = String(error.name ?? '');
  const code = String(error.Code ?? error.code ?? '');
  const message = String(error.message ?? '');
  const normalized = `${name} ${code} ${message}`.toLowerCase();
  return normalized.includes('replicationconfigurationnotfound');
}

export const s3ReplicationEnricher: Enricher = {
  name: 'aws-s3-replication',
  provider: 'aws',
  appliesTo: (node) => node.provider === 'aws' && node.type === 'OBJECT_STORAGE',

  enrich: async (nodes, credentials, region): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;
    let failed = 0;
    let skipped = 0;

    const clients = new Map<string, S3Client>();
    const getClient = (awsRegion: string): S3Client => {
      const existing = clients.get(awsRegion);
      if (existing) return existing;

      const creds = credentials as DiscoveryCloudCredentials;
      const resolved = resolveAwsCredentials(creds, awsRegion, 'stronghold-enrichment-s3');
      const created = new S3Client({
        region: awsRegion,
        ...(resolved ? { credentials: resolved } : {}),
      });
      clients.set(awsRegion, created);
      return created;
    };

    for (const node of nodes) {
      const metadata = getNodeMetadata(node);
      const bucketName = resolveBucketName({
        id: node.id,
        resourceId: node.resourceId,
        name: node.name,
        metadata,
      });
      if (!bucketName) {
        skipped += 1;
        continue;
      }

      const bucketRegion = resolveNodeRegion(node, region) ?? 'us-east-1';
      const client = getClient(bucketRegion);
      let nodeFailed = false;

      try {
        const versioningResponse = await client.send(
          new GetBucketVersioningCommand({ Bucket: bucketName }),
        );
        setNodeMetadata(node, {
          versioningStatus: versioningResponse.Status ?? 'Disabled',
        });
      } catch (error) {
        nodeFailed = true;
        setNodeMetadata(node, { versioningStatus: null });
        void toErrorMessage(error);
      }

      try {
        const replicationResponse = await client.send(
          new GetBucketReplicationCommand({ Bucket: bucketName }),
        );
        const ruleCount = replicationResponse.ReplicationConfiguration?.Rules?.length ?? 0;
        setNodeMetadata(node, {
          hasCrossRegionReplication: ruleCount > 0,
          replicationRules: ruleCount,
        });
      } catch (error) {
        if (isReplicationConfigMissing(error)) {
          setNodeMetadata(node, {
            hasCrossRegionReplication: false,
            replicationRules: 0,
          });
        } else {
          nodeFailed = true;
          setNodeMetadata(node, {
            hasCrossRegionReplication: null,
            replicationRules: null,
          });
          void toErrorMessage(error);
        }
      }

      if (nodeFailed) {
        failed += 1;
      } else {
        enriched += 1;
      }
    }

    return { enriched, failed, skipped, durationMs: Date.now() - start };
  },
};
