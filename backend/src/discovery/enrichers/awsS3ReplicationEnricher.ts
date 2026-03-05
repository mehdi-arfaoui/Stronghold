import {
  GetBucketReplicationCommand,
  GetBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { appLogger } from "../../utils/logger.js";
import type { Enricher, EnrichmentResult } from "./types.js";
import {
  getNodeMetadata,
  isAccessDeniedError,
  isRecord,
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
        RoleSessionName: "stronghold-enrichment-s3",
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

function resolveBucketName(node: {
  externalId: string | null | undefined;
  name: string;
  metadata: Record<string, unknown>;
}): string | null {
  const fromMetadata = readString(node.metadata.bucketName);
  if (fromMetadata) return fromMetadata;

  const fromExternalId = readString(node.externalId);
  if (fromExternalId?.startsWith("arn:aws:s3:::")) {
    const bucketName = fromExternalId.slice("arn:aws:s3:::".length).trim();
    if (bucketName.length > 0) return bucketName;
  }

  return readString(node.name);
}

function isReplicationConfigMissing(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const name = String(error.name || "");
  const code = String(error.Code || error.code || "");
  const message = String(error.message || "");
  const normalized = `${name} ${code} ${message}`.toLowerCase();
  return normalized.includes("replicationconfigurationnotfound");
}

export const awsS3ReplicationEnricher: Enricher = {
  name: "aws-s3-replication",
  provider: "aws",
  appliesTo: (node) => node.provider === "aws" && node.type === "OBJECT_STORAGE",

  enrich: async (
    nodes,
    credentials,
    region,
  ): Promise<EnrichmentResult> => {
    const start = Date.now();
    let enriched = 0;
    let failed = 0;
    let skipped = 0;

    const clients = new Map<string, S3Client>();
    const getClient = (awsRegion: string): S3Client => {
      const existing = clients.get(awsRegion);
      if (existing) return existing;

      const clientCredentials = resolveAwsClientCredentials(credentials, awsRegion);
      const created = new S3Client({
        region: awsRegion,
        ...(clientCredentials ? { credentials: clientCredentials as any } : {}),
      });
      clients.set(awsRegion, created);
      return created;
    };

    for (const node of nodes) {
      const metadata = getNodeMetadata(node);
      const bucketName = resolveBucketName({
        externalId: node.externalId,
        name: node.name,
        metadata,
      });
      if (!bucketName) {
        skipped += 1;
        continue;
      }

      const bucketRegion = resolveNodeRegion(node, region) || "us-east-1";
      const client = getClient(bucketRegion);
      let nodeFailed = false;

      try {
        const versioningResponse = await client.send(
          new GetBucketVersioningCommand({ Bucket: bucketName }),
        );
        setNodeMetadata(node, {
          versioningStatus: versioningResponse.Status || "Disabled",
        });
      } catch (error) {
        nodeFailed = true;
        setNodeMetadata(node, {
          versioningStatus: null,
        });
        appLogger.debug("[MetadataEnrichment] aws-s3-replication versioning failed", {
          bucketName,
          region: bucketRegion,
          accessDenied: isAccessDeniedError(error),
          message: toErrorMessage(error),
        });
      }

      try {
        const replicationResponse = await client.send(
          new GetBucketReplicationCommand({ Bucket: bucketName }),
        );
        const ruleCount =
          replicationResponse.ReplicationConfiguration?.Rules?.length || 0;
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
          appLogger.debug("[MetadataEnrichment] aws-s3-replication replication failed", {
            bucketName,
            region: bucketRegion,
            accessDenied: isAccessDeniedError(error),
            message: toErrorMessage(error),
          });
        }
      }

      if (nodeFailed) {
        failed += 1;
      } else {
        enriched += 1;
      }
    }

    return {
      enriched,
      failed,
      skipped,
      durationMs: Date.now() - start,
    };
  },
};
